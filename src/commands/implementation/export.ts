import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'

export default class ImplementationExport extends PlatformCommand<typeof ImplementationExport> {
  static summary = 'Export an implementation as one portable JSON document.'

  static description = `${SERVER_DATA}

The export is keyed by segment codes, positions and loop identifiers rather than database ids, so it reads the same anywhere: keep it in version control, diff two revisions of a partner specification, or attach it to a support conversation. The output is the document itself, so --json and the default print the same thing; -o writes it to a file.`

  static examples = [
    '<%= config.bin %> implementation export 9c1b2a3d-... -o acme-856.json',
    '<%= config.bin %> implementation export 9c1b2a3d-... > acme-856.json',
  ]

  static args = {
    id: Args.string({description: 'Implementation id (from `implementation list` or `partner get`).', required: true}),
  }

  static flags = {
    output: Flags.string({char: 'o', description: 'Write the export to this file instead of stdout.'}),
  }

  async run(): Promise<unknown> {
    const client = await this.getAuthedClient()
    const doc = await client.implementationExport(this.requireId(this.args.id, 'implementation id'))
    const text = JSON.stringify(doc, null, 2)

    if (this.flags.output && this.flags.output !== '-') {
      await writeFileAtomic(this.flags.output, `${text}\n`, 0o644)
      this.log(`Wrote ${Buffer.byteLength(text) + 1} bytes to ${this.flags.output}.`)
    } else if (!this.jsonEnabled()) {
      this.log(text)
    }

    return doc
  }
}
