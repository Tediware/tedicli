import {Args} from '@oclif/core'

import {X12Command} from '../../x12-base-command.js'

export default class X12Segment extends X12Command<typeof X12Segment> {
  static description = 'Look up an X12 segment definition (e.g. N1).'

  static examples = ['<%= config.bin %> x12 segment N1', '<%= config.bin %> x12 segment REF -r 005010']

  static args = {
    id: Args.string({description: 'Segment id, e.g. N1.', required: true}),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    const doc = await client.x12Segment(this.args.id, req)
    this.printReference(doc)
  }
}
