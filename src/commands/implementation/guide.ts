import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {JsonNotOfferedError} from '../../lib/errors.js'

export default class ImplementationGuide extends PlatformCommand<typeof ImplementationGuide> {
  // Presentation only, like the X12 reference: the guide is rendered
  // server-side and there is no JSON tree. The flag still parses (hidden) so
  // it fails with the reasoning rather than "Nonexistent flag".
  static enableJsonFlag = false

  static summary = "Print an implementation's guide: every loop, segment and element it uses, with requirements and codes."

  static description = `${SERVER_DATA}

Rendered by the server as console text (default) or markdown. The structure as data is \`implementation schema\`.`

  static examples = [
    '<%= config.bin %> implementation guide 9c1b2a3d-...',
    '<%= config.bin %> implementation guide 9c1b2a3d-... --format markdown -o acme-856.md',
  ]

  static args = {
    id: Args.string({description: 'Implementation id (from `implementation list` or `partner get`).', required: true}),
  }

  static flags = {
    format: Flags.option({
      options: ['console', 'markdown'] as const,
      default: 'console',
      description: 'Rendering. The guide is presentation-only; JSON is not offered.',
    })(),
    output: Flags.string({char: 'o', description: 'Write the guide to this file instead of stdout.'}),
    json: Flags.boolean({hidden: true}),
  }

  async run(): Promise<void> {
    if (this.flags.json) {
      throw new JsonNotOfferedError('the guide is a rendered document.', [
        'Use --format markdown for a file, or `tedi implementation schema <id>` for the structure as JSON.',
      ])
    }

    const client = await this.getAuthedClient()
    const text = await client.implementationGuide(this.requireId(this.args.id, 'implementation id'), this.flags.format)

    if (this.flags.output && this.flags.output !== '-') {
      await writeFileAtomic(this.flags.output, text, 0o644)
      this.log(`Wrote ${Buffer.byteLength(text)} bytes to ${this.flags.output}.`)
      return
    }

    process.stdout.write(text)
    if (process.stdout.isTTY && !text.endsWith('\n')) process.stdout.write('\n')
  }
}
