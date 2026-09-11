import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'

export default class ImplementationSchema extends PlatformCommand<typeof ImplementationSchema> {
  static summary = 'Print the JSON schema a mapping targets for this implementation.'

  static description = `${SERVER_DATA}

This is the shape a mapping targeting the implementation must produce: the partner's document for an outbound mapping, your canonical shape for an inbound one. The output is the schema itself, so --json and the default print the same document; -o writes it to a file.`

  static examples = [
    '<%= config.bin %> implementation schema 9c1b2a3d-...',
    '<%= config.bin %> implementation schema 9c1b2a3d-... -o acme-856.schema.json',
  ]

  static args = {
    id: Args.string({description: 'Implementation id (from `implementation list` or `partner get`).', required: true}),
  }

  static flags = {
    output: Flags.string({char: 'o', description: 'Write the schema to this file instead of stdout.'}),
  }

  async run(): Promise<unknown> {
    const client = await this.getAuthedClient()
    const schema = await client.implementationSchema(this.requireId(this.args.id, 'implementation id'))
    const text = JSON.stringify(schema, null, 2)

    if (this.flags.output && this.flags.output !== '-') {
      await writeFileAtomic(this.flags.output, `${text}\n`, 0o644)
      this.log(`Wrote ${Buffer.byteLength(text) + 1} bytes to ${this.flags.output}.`)
    } else if (!this.jsonEnabled()) {
      this.log(text)
    }

    return schema
  }
}
