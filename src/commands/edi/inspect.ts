import {Args, Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {readEdiInput} from '../../lib/edi-input.js'
import {describeObfuscation, NotAnInterchangeError, obfuscateInterchange} from '../../lib/edi-obfuscate.js'
import {TediError} from '../../lib/errors.js'
import {wantsColor} from '../../lib/output.js'

export default class EdiInspect extends BaseCommand<typeof EdiInspect> {
  static summary = 'Inspect an X12 interchange: envelope checks, structure, and validation against the standard.'

  static description = `Unlike \`edi obfuscate\`, this command SENDS YOUR FILE to the Tediware platform, which is where the parser and the licensed X12 reference data it validates against live. An API key is required.

Pass --obfuscate to scrub personal data locally before the upload, using the same engine as \`tedi edi obfuscate\`. That scrub is format-preserving — delimiters, element lengths, qualifiers, control numbers and segment counts are untouched — so the report describes exactly the structure of your original file while no personal data leaves your machine.

Findings anchor to the report's line numbers: the report reprints the interchange one segment per line.`

  static examples = [
    '<%= config.bin %> edi inspect claims.edi',
    '<%= config.bin %> edi inspect claims.edi --obfuscate',
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
      description: 'Replace personal data with format-preserving fakes locally, before uploading.',
    }),
    seed: Flags.string({
      dependsOn: ['obfuscate'],
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
   * Obfuscate when asked, and otherwise make the upload visible. This is the one
   * `edi` command that sends the file off the machine, so an interactive run
   * says so and names the flag that prevents it. The notice is suppressed when
   * stderr isn't a terminal, so scripted and piped runs stay quiet.
   */
  private prepareUpload(source: string): string {
    if (!this.flags.obfuscate) {
      if (process.stderr.isTTY) {
        this.logToStderr(
          'Uploading this interchange as-is; pass --obfuscate to replace personal data with fakes first.',
        )
      }
      return source
    }

    try {
      const result = obfuscateInterchange(source, {seed: this.flags.seed})
      this.logToStderr(`${describeObfuscation(result)} before upload.`)
      return result.output
    } catch (err) {
      // Obfuscation needs a well-formed envelope, but a broken envelope is a
      // common reason to reach for inspect in the first place. Say what the way
      // forward is, and be explicit that it means uploading the file unscrubbed.
      if (err instanceof NotAnInterchangeError) {
        throw new TediError(err.message, {
          suggestions: [
            ...err.suggestions,
            'Local obfuscation needs a readable ISA envelope. To have the server diagnose the envelope instead, re-run without --obfuscate — that uploads the file as-is.',
          ],
        })
      }
      throw err
    }
  }
}
