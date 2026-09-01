import {Args} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'

export default class TransactionResend extends PlatformCommand<typeof TransactionResend> {
  static description =
    'Re-deliver a past outbound transaction byte-for-byte, original control numbers preserved.'

  static examples = ['<%= config.bin %> transaction resend 8f14e45f-...']

  static args = {
    id: Args.string({description: 'Transaction id of the outbound document to re-deliver.', required: true}),
  }

  async run(): Promise<{ediTransactionId: string}> {
    const client = await this.getAuthedClient()
    const receipt = await client.transactionResend(this.args.id)
    // The server answers 202: the resend is queued, not yet delivered.
    this.log(`Resend started for ${receipt.ediTransactionId}.`)
    this.log('Delivery runs in the background; check `tedi transaction get` for the resend count.')
    return receipt
  }
}
