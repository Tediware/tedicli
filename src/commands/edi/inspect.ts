import {Args, Flags} from '@oclif/core'

import {assertInspectableSize, InspectionFindings} from '../../lib/api-client.js'
import {BaseCommand} from '../../base-command.js'
import {readEdiInput} from '../../lib/edi-input.js'
import {describeObfuscation, obfuscateInterchange} from '../../lib/edi-obfuscate.js'
import {EXIT_DEFECT, EXIT_UNUSABLE, TediError} from '../../lib/errors.js'
import {wantsColor} from '../../lib/output.js'

export default class EdiInspect extends BaseCommand<typeof EdiInspect> {
  static summary = 'Inspect an X12 interchange: envelope checks, structure, and validation against the standard.'

  static description = `Unlike \`edi obfuscate\`, this command SENDS YOUR FILE to the Tediware platform, which is where the parser and the licensed X12 reference data it validates against live. An API key is required.

Personal data is therefore scrubbed locally first, by default, using the same engine as \`tedi edi obfuscate\`. That scrub is format-preserving — delimiters, element lengths, qualifiers, code values, control numbers and segment counts are untouched — so the report describes exactly the structure of your original file while the personal data in it never leaves your machine. Findings that quote a personal value will quote the replacement rather than what is in your file; business identifiers, codes, amounts and control numbers are kept as-is.

Pass --no-obfuscate to upload the file verbatim. That is worth doing when a finding you expect is missing, or when the scrub cannot read the envelope well enough to run.

Findings anchor to the report's line numbers: the report reprints the interchange one segment per line.

Exit codes are meant for CI: 0 when the inspection ran and found nothing, 1 when it found something (see --fail-on), and 2 when it could not run — no key, rate limited, an unsupported release, a server fault, or an inspection the server reports as incomplete. Only 1 means "your document is bad".`

  static examples = [
    '<%= config.bin %> edi inspect claims.edi',
    '<%= config.bin %> edi inspect claims.edi --no-obfuscate',
    '<%= config.bin %> edi inspect claims.edi --format markdown > report.md',
    'cat claims.edi | <%= config.bin %> edi inspect -',
    '<%= config.bin %> edi inspect claims.edi --fail-on notice',
  ]

  static args = {
    file: Args.string({description: "Path to the EDI file, or '-' to read from stdin.", required: true}),
  }

  static flags = {
    format: Flags.option({
      options: ['console', 'markdown'] as const,
      default: 'console',
      description: 'Output format for the report.',
    })(),
    obfuscate: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Replace personal data with format-preserving fakes locally before uploading. Use --no-obfuscate to send the file verbatim.',
    }),
    seed: Flags.string({
      description: 'Seed the obfuscation so repeated runs upload identical replacements.',
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
      throw new TediError(
        'Inspection reports are rendered server-side as `--format console` or `--format markdown`; JSON is not offered.',
      )
    }
    if (this.flags.seed !== undefined && !this.flags.obfuscate) {
      throw new TediError('--seed sets up the local scrub, which --no-obfuscate turns off. Pass one or the other.')
    }

    const {format} = this.flags
    const source = await readEdiInput(this.args.file, (message) => this.logToStderr(message))
    if (source.trim() === '') {
      // Nothing here could be inspected, and saying so locally costs a round
      // trip less than the server's refusal (`missing_parameter` for a truly
      // empty body) and names the file the user actually passed.
      throw new TediError(
        `There is nothing to inspect: ${this.args.file === '-' ? 'stdin was empty' : `${this.args.file} is empty`}.`,
      )
    }
    // Check the size before scrubbing, not just before sending: the scrub is
    // length-preserving, so a document that is too large was always going to be,
    // and reporting "obfuscated 400000 values" right before refusing to send
    // them reads like the scrub was the problem.
    assertInspectableSize(source)

    // Authenticate before scrubbing, for the same reason the size check runs
    // first: the scrub is the expensive, chatty step, and reporting "obfuscated
    // 400 values before upload" immediately ahead of "you are not signed in"
    // describes an upload that was never going to happen.
    const client = await this.getAuthedClient()
    const payload = this.prepareUpload(source)

    const report = await client.ediInspect(payload, {
      format,
      color: wantsColor(format, {noColorFlag: this.flags['no-color']}),
    })
    this.log(report.body)
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
   * which abandons whatever is still buffered in stdout — on macOS that silently
   * truncates a piped report at 64 KB. Exiting normally lets Node drain it
   * first. The report is what the user asked for; cutting it off to deliver an
   * exit code sooner is the wrong trade.
   */
  private exitForFindings(findings?: InspectionFindings): void {
    if (!findings) {
      this.warn(
        'This server did not report what the inspection found, so the exit code cannot reflect the report above. Read it yourself, and check that api.baseUrl points at a current Tediware server.',
      )
      process.exitCode = EXIT_UNUSABLE
      return
    }

    const {complete, errors, notices} = findings
    const counted = this.flags['fail-on'] === 'notice' ? errors + notices : errors

    if (counted > 0) {
      const why = errors === 0 ? ' Failing on notices (--fail-on notice).' : ''
      const caveat = complete ? '' : ' At least one check did not run, so there may be more.'
      this.logToStderr(`${summarize(errors, notices)}.${why}${caveat}`)
      process.exitCode = EXIT_DEFECT
      return
    }

    if (!complete) {
      this.warn(
        'The server reports that at least one check did not run, and nothing that did run failed this document: findings vanish with a crashed check, so the report above is not evidence that the interchange is sound. Re-run it, and report the failure to Tediware if it persists.',
      )
      process.exitCode = EXIT_UNUSABLE
    }
  }

  /**
   * Scrub the document unless the user opted out. This is the one `edi` command
   * that sends the file off the machine, so the safe path is the default one:
   * forgetting a flag must not be what puts personal data on the wire. Both
   * paths report what happened on stderr — the scrub because the report's quoted
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
      const result = obfuscateInterchange(source, {seed: this.flags.seed})
      this.logToStderr(`${describeObfuscation(result)} before upload.\n`)
      return result.output
    } catch (err) {
      // The scrub needs a readable envelope, but a broken envelope is a common
      // reason to reach for inspect in the first place. Say what the way forward
      // is, and be explicit that it means uploading the file unscrubbed.
      if (err instanceof TediError) {
        throw new TediError(err.message, {
          suggestions: [
            ...err.suggestions,
            'The local scrub needs a readable ISA envelope. To have the server diagnose this file instead, re-run with --no-obfuscate — that uploads it verbatim.',
          ],
          // Deliberately "could not run", not the scrub's own exit 1. The scrub
          // reads the envelope more strictly than the server's parser does, so
          // its refusal is inconclusive about the file: the way forward is
          // --no-obfuscate, not "this document is invalid".
          exitCode: EXIT_UNUSABLE,
        })
      }
      throw err
    }
  }
}

/** "3 errors, 1 notice" — the counts, worded for a one-line summary. */
function summarize(errors: number, notices: number): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  return `${count(errors, 'error')}, ${count(notices, 'notice')}`
}
