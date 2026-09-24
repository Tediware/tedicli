import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ResultPayload as Payload} from '../../lib/platform.js'

export default class ResultPayload extends PlatformCommand<typeof ResultPayload> {
  static summary = "Print a result's payload: the data that node produced."

  static description = `${SERVER_DATA}

A payload is kept on the result itself. It is not an artifact: artifacts are stored files a result points to, downloaded with \`artifact get\`. EDI prints as raw text and JSON pretty-printed; --json returns the whole {format, contents} envelope.

A failed result's payload is only its error. To see the document the failing node refused, read the payload of its incoming result, which \`tedi trace\` suggests. Results are kept for 45 days.`

  static examples = [
    '<%= config.bin %> result payload 4d0e9f5a-...',
    '<%= config.bin %> result payload 4d0e9f5a-... --keys-only',
    '<%= config.bin %> result payload 4d0e9f5a-... --json-path transactions.0.AT7',
    '<%= config.bin %> result payload 4d0e9f5a-... --json',
  ]

  static args = {
    id: Args.string({description: 'Result id (from `tedi trace`, `result list`, or a webhook delivery).', required: true}),
  }

  static flags = {
    'json-path': Flags.string({
      description: 'Dot-path into the contents; numeric segments index arrays, for example transactions.0.AT7.',
    }),
    'keys-only': Flags.boolean({
      description: 'Print only the shape of the contents: keys, types and array lengths, four levels deep.',
    }),
  }

  async run(): Promise<Payload> {
    const id = this.requireId(this.args.id, 'result id')
    const client = await this.getAuthedClient()
    const payload = await client.resultPayload(id, {
      jsonPath: this.flags['json-path'],
      keysOnly: this.flags['keys-only'],
    })

    const {contents} = payload
    this.log(typeof contents === 'string' ? contents.replace(/\n$/, '') : JSON.stringify(contents, null, 2))

    return payload
  }
}
