import {Args, Flags} from '@oclif/core'

import {assertInspectableSize, InspectionFindings} from '../../lib/api-client.js'
import {BaseCommand} from '../../base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {readEdiInput} from '../../lib/edi-input.js'
import {describeObfuscation, obfuscateInterchange} from '../../lib/edi-obfuscate.js'
import {EXIT_DEFECT, EXIT_UNUSABLE, IdentityUnavailableError, JsonNotOfferedError, TediError} from '../../lib/errors.js'
import {wantsColor} from '../../lib/output.js'

export default class EdiInspect extends BaseCommand<typeof EdiInspect> {
  static summary = 'Inspect an X12 interchange: envelope checks, structure, and validation against the standard.'

  static description = `Sends your file to the Tediware server, which is where the parser and the licensed X12 reference data it validates against live. An API key is required.

Personal data is therefore scrubbed locally first, by default, using the same engine and the same defaults as \`tedi edi obfuscate\` (healthcare documents scrub fully; supply-chain documents keep business parties and free text; --scrub-parties and --scrub-text move the line). That scrub is format-preserving, so the report describes exactly the structure of your original file while the personal data in it never leaves your machine. Findings that quote a personal value quote the replacement rather than what is in your file; business identifiers, codes, amounts and control numbers are kept as-is.

Pass --no-obfuscate to upload the file verbatim. That is worth doing when a finding you expect is missing, or when the scrub cannot read the envelope well enough to run.

Findings cite the segment's position in the report, which shows the interchange as an annotated tree, not the line numbers of your file.

Exit codes are meant for CI and agents: 0 when the inspection ran and found nothing, 1 when it found something (see --fail-on) or the file is not an X12 interchange, and 2 when it could not run: no key, rate limited, an unsupported release, a server fault, or an inspection the server reports as incomplete. Only 1 means "your document is bad". A one-line finding count with the exit reason goes to stderr on every run.`

  static examples = [
    '<%= config.bin %> edi inspect claims.edi',
    '<%= config.bin %> edi inspect claims.edi --no-obfuscate',
    '<%= config.bin %> edi inspect claims.edi --format markdown -o report.md',
    '<%= config.bin %> edi inspect - < claims.edi',
    '<%= config.bin %> edi inspect claims.edi --fail-on notice',
  ]

  static args = {
    file: Args.string({
      description: "Path to the EDI file, or '-' for stdin. Stdin is also read when the argument is omitted on a pipe.",
      ignoreStdin: true,
    }),
  }

  static flags = {
    format: Flags.option({
      options: ['console', 'markdown'] as const,
      default: 'console',
      description: 'Output format for the report.',
    })(),
    output: Flags.string({
      char: 'o',
      description: "Write the report to this file instead of stdout ('-' is stdout).",
    }),
    obfuscate: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Replace personal data with format-preserving fakes locally before uploading. Use --no-obfuscate to send the file verbatim.',
    }),
    seed: Flags.string({
      description: 'Seed the obfuscation so repeated runs upload identical replacements. An empty seed means no seed.',
    }),
    'scrub-parties': Flags.boolean({
      description: 'Treat every N1 ship-to (ST) and bill-to (BT) party as a person before uploading.',
    }),
    'scrub-text': Flags.boolean({
      description: 'Scrub free text (MSG, MTX, NTE, K3) before uploading, whatever the document family.',
    }),
    'fail-on': Flags.option({
      options: ['error', 'notice'] as const,
      default: 'error',
      description: 'Which findings exit 1. `error` counts only errors; `notice` counts notices too.',
    })(),
    // Declared so `--json` gets an explanatory message rather than oclif's
    // generic "Nonexistent flag". Hidden from help.
    json: Flags.boolean({hidden: true}),
  }

  async run(): Promise<void> {
    if (this.flags.json) {
      throw new JsonNotOfferedError('inspection reports quote the licensed standard and are presentation-only.', [
        'Reports are available as `--format console` (the default) or `--format markdown`.',
        'Branch on the exit code, and read the finding count on stderr.',
      ])
    }
    if (!this.flags.obfuscate) {
      for (const flag of ['seed', 'scrub-parties', 'scrub-text'] as const) {
        if (this.flags[flag]) {
          throw new TediError(`--${flag} sets up the local scrub, which --no-obfuscate turns off. Pass one or the other.`)
        }
      }
    }

    const {format} = this.flags
    const source = await readEdiInput(this.args.file, (message) => this.logToStderr(message))
    if (source.trim() === '') {
      // Nothing here could be inspected, and saying so locally costs a round
      // trip less than the server's refusal (`missing_parameter` for a truly
      // empty body) and names the file the user actually passed.
      throw new TediError(
        `There is nothing to inspect: ${!this.args.file || this.args.file === '-' ? 'stdin was empty' : `${this.args.file} is empty`}.`,
        {exitCode: EXIT_DEFECT},
      )
    }
    // Check the size before scrubbing, not just before sending: the scrub is
    // length-preserving, so a document that is too large was always going to be,
    // and reporting "obfuscated 400000 values" right before refusing to send
    // them reads like the scrub was the problem.
    assertInspectableSize(source)

    // Authenticate before scrubbing, for the same reason the size check runs
    // first: reporting "obfuscated 400 values before upload" immediately ahead
    // of "your key was rejected" describes an upload that was never going to
    // happen. The key is checked with the server, not merely for presence.
    const client = await this.getAuthedClient()
    try {
      await client.whoami()
    } catch (err) {
      // An older server has no identity endpoint; the upload itself will say.
      if (!(err instanceof IdentityUnavailableError)) throw err
    }
    const payload = this.prepareUpload(source)

    // A report going to a file gets no color: the terminal test is about
    // stdout, and the file is not stdout. --color still forces it.
    const toFile = Boolean(this.flags.output && this.flags.output !== '-')
    const report = await client.ediInspect(payload, {
      format,
      color: wantsColor(format, {noColorFlag: this.noColorFlag, colorFlag: this.colorFlag, isTty: toFile ? false : undefined}),
    })
    if (toFile && this.flags.output) {
      await writeFileAtomic(this.flags.output, report.body.endsWith('\n') ? report.body : `${report.body}\n`, 0o644)
      this.logToStderr(`Wrote ${this.flags.output}.`)
    } else {
      this.log(report.body)
    }
    this.exitForFindings(report.findings)
  }

  /**
   * Turn the server's findings summary into an exit code, so a CI job can gate
   * on this command without parsing the report.
   *
   * The report is already printed by the time this runs; every path here shows
   * the user what came back, and only the exit code differs. Two of them exit 2
   * despite a report that looks fine, because a report is only evidence if
   * something actually examined the document:
   *
   *   - `complete=false` means at least one check crashed, and the inspection is
   *     fail-soft, so its findings vanished rather than surfacing. Zero errors
   *     there does not mean zero errors.
   *   - no summary at all means the server predates these headers. Absence is
   *     not zero either, and silently exiting 0 would be a green build nobody
   *     earned.
   *
   * Findings are weighed first, though: a crashed check loses findings, it never
   * invents them, so anything that did surface is a real verdict on the document
   * and incompleteness is a caveat on it rather than grounds to throw it away.
   *
   * This sets `process.exitCode` and returns instead of calling `this.exit()`.
   * `this.exit()` throws, and oclif's handler answers that with `process.exit()`,
   * which abandons whatever is still buffered in stdout; on macOS that silently
   * truncates a piped report at 64 KB. Exiting normally lets Node drain it
   * first. The report is what the user asked for; cutting it off to deliver an
   * exit code sooner is the wrong trade.
   *
   * The count line is printed on every run, in one shape, with the exit reason,
   * so a redirected report always says why the build passed or failed.
   */
  private exitForFindings(findings?: InspectionFindings): void {
    if (!findings) {
      this.warn(
        'This server did not report what the inspection found, so the exit code cannot reflect the report above. Read it yourself, and check that api.baseUrl points at a current Tediware server.',
      )
      this.logToStderr(`Findings unknown. Exit ${EXIT_UNUSABLE} (no finding counts from the server).`)
      process.exitCode = EXIT_UNUSABLE
      return
    }

    const {complete, errors, notices} = findings
    const counted = this.flags['fail-on'] === 'notice' ? errors + notices : errors
    const caveat = complete ? '' : ' At least one check did not run, so there may be more.'

    if (counted > 0) {
      const why = errors === 0 ? 'notices, with --fail-on notice' : this.flags['fail-on'] === 'notice' ? 'errors and notices' : 'errors'
      this.logToStderr(`${summarize(errors, notices)}. Exit ${EXIT_DEFECT} (${why}).${caveat}`)
      process.exitCode = EXIT_DEFECT
      return
    }

    if (!complete) {
      this.warn(
        'The server reports that at least one check did not run, and nothing that did run failed this document: findings vanish with a crashed check, so the report above is not evidence that the interchange is sound. Re-run it, and report the failure to Tediware if it persists.',
      )
      this.logToStderr(`${summarize(errors, notices)}. Exit ${EXIT_UNUSABLE} (inspection incomplete).`)
      process.exitCode = EXIT_UNUSABLE
      return
    }

    const ignored = notices > 0 ? ' Notices do not count without --fail-on notice.' : ''
    this.logToStderr(`${summarize(errors, notices)}. Exit 0.${ignored}`)
  }

  /**
   * Scrub the document unless the user opted out. This is the one `edi` command
   * that sends the file off the machine, so the safe path is the default one:
   * forgetting a flag must not be what puts personal data on the wire. Both
   * paths report what happened on stderr: the scrub because the report's quoted
   * values will be replacements, the opt-out because "this run uploaded the file
   * unscrubbed" is worth having in a log.
   *
   * Each notice ends with a blank line so it reads as a preamble rather than as
   * the report's first line, which is how it looks on a terminal, where stderr
   * and stdout land together.
   */
  private prepareUpload(source: string): string {
    if (!this.flags.obfuscate) {
      this.logToStderr('Uploading this interchange verbatim (--no-obfuscate).\n')
      return source
    }

    try {
      const result = obfuscateInterchange(source, {
        seed: this.flags.seed,
        scrubParties: this.flags['scrub-parties'],
        scrubText: this.flags['scrub-text'],
      })
      this.logToStderr(`${describeObfuscation(result)} before upload.\n`)
      return result.output
    } catch (err) {
      // The scrub needs a readable envelope, but a broken envelope is a common
      // reason to reach for inspect in the first place. Say what the way forward
      // is, and be explicit that it means uploading the file unscrubbed. The
      // exit code is the scrub's own: "not an X12 interchange" is a finding
      // about the file on every path, so an agent can key on 1 and retry with
      // --no-obfuscate for the server's fuller diagnosis.
      if (err instanceof TediError) {
        throw new TediError(err.message, {
          suggestions: [
            ...err.suggestions,
            'The local scrub needs a readable ISA envelope. To have the server diagnose this file instead, re-run with --no-obfuscate, which uploads it verbatim.',
          ],
          exitCode: err.exitCode,
          code: err.code,
        })
      }
      throw err
    }
  }
}

/** "3 errors, 1 notice": the counts, worded for a one-line summary. */
function summarize(errors: number, notices: number): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  return `${count(errors, 'error')}, ${count(notices, 'notice')}`
}
