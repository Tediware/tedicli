import {Args} from '@oclif/core'

import {SERVER_LOOKUP, X12_LICENSE_NOTICE, X12Command} from '../../x12-base-command.js'

export default class X12Seg extends X12Command<typeof X12Seg> {
  // `segment` keeps working but stays out of the help listing; `seg` is canonical.
  static hiddenAliases = ['x12:segment']

  static summary = 'Look up an X12 segment definition (e.g. N1).'

  static description = `${SERVER_LOOKUP}

${X12_LICENSE_NOTICE}`

  static examples = ['<%= config.bin %> x12 seg N1', '<%= config.bin %> x12 seg REF -r 005010']

  static args = {
    id: Args.string({description: 'Segment id, e.g. N1 (case-insensitive).', required: true}),
  }

  async run(): Promise<void> {
    const id = this.referenceId(this.args.id, 'segment id')
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    const doc = await client.x12Segment(id, req)
    this.printReference(doc)
  }
}
