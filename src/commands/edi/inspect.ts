import {Args, Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {readEdiInput} from '../../lib/edi-input.js'
import {describeObfuscation, obfuscateInterchange} from '../../lib/edi-obfuscate.js'
import {TediError} from '../../lib/errors.js'
import {wantsColor} from '../../lib/output.js'

export default class EdiInspect extends BaseCommand<typeof EdiInspect> {
  static summary = 'Inspect an X12 interchange: envelope checks, structure, and validation against the standard.'

  static description = `Unlike \`edi obfuscate\`, this command SENDS YOUR FILE to the Tediware platform, which is where the parser and the licensed X12 reference data it validates against live. An API key is required.

Personal data is therefore scrubbed locally first, by default, using the same engine as \`tedi edi obfuscate\`. That scrub is format-preserving — delimiters, element lengths, qualifiers, code values, control numbers and segment counts are untouched — so the report describes exactly the structure of your original file while the personal data in it never leaves your machine. Findings that quote a personal value will quote the replacement rather than what is in your file; business identifiers, codes, amounts and control numbers are kept as-is.

Pass --no-obfuscate to upload the file verbatim. That is worth doing when a finding you expect is missing, or when the scrub cannot read the envelope well enough to run.

Findings anchor to the report's line numbers: the report reprints the interchange one segment per line.`

  static examples = [
    '<%= config.bin %> edi inspect claims.edi',
    '<%= config.bin %> edi inspect claims.edi --no-obfuscate',
    '<%= config.bin %> edi inspect claims.edi --format markdown > report.md',
    'cat claims.edi | <%= config.bin %> edi inspect -',
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
    const payload = this.prepareUpload(source)

    const client = await this.getAuthedClient()
    const report = await client.ediInspect(payload, {
      format,
      color: wantsColor(format, {noColorFlag: this.flags['no-color']}),
    })
    this.log(report.body)
  }

  /**
   * Scrub the document unless the user opted out. This is the one `edi` command
   * that sends the file off the machine, so the safe path is the default one:
   * forgetting a flag must not be what puts personal data on the wire. Both
   * paths report what happened on stderr — the scrub because the report's quoted
   * values will be replacements, the opt-out because "this run uploaded the file
   * unscrubbed" is worth having in a log.
   */
  private prepareUpload(source: string): string {
    if (!this.flags.obfuscate) {
      this.logToStderr('Uploading this interchange verbatim (--no-obfuscate).')
      return source
    }

    try {
      const result = obfuscateInterchange(source, {seed: this.flags.seed})
      this.logToStderr(`${describeObfuscation(result)} before upload.`)
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
        })
      }
      throw err
    }
  }
}
