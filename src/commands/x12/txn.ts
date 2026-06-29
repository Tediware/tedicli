import {Args} from '@oclif/core'

import {X12Command} from '../../x12-base-command.js'

export default class X12Txn extends X12Command<typeof X12Txn> {
  // `transaction` keeps working but stays out of the help listing; `txn` is canonical.
  static hiddenAliases = ['x12:transaction']

  static description = 'Look up an X12 transaction set and its loop structure (e.g. 856).'

  static examples = ['<%= config.bin %> x12 txn 856', '<%= config.bin %> x12 txn SH856 -r 005010']

  static args = {
    id: Args.string({
      description:
        'Transaction set code, e.g. 856 (case-insensitive). The functional-group form (SH856) is also accepted.',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    // Accept any case; functional-group forms like sh856 normalize to SH856.
    const doc = await client.x12Transaction(this.args.id.toUpperCase(), req)
    this.printReference(doc)
  }
}
