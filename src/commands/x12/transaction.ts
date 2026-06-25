import {Args} from '@oclif/core'

import {X12Command} from '../../x12-base-command.js'

export default class X12Transaction extends X12Command<typeof X12Transaction> {
  static description = 'Look up an X12 transaction set and its loop structure (e.g. 856).'

  static examples = ['<%= config.bin %> x12 transaction 856', '<%= config.bin %> x12 transaction SH856 -r 005010']

  static args = {
    id: Args.string({
      description: 'Transaction set code, e.g. 856. The functional-group form (SH856) is also accepted.',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    const doc = await client.x12Transaction(this.args.id, req)
    this.printReference(doc)
  }
}
