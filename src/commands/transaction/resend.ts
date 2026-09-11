import {Args} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {ResendReceipt} from '../../lib/platform.js'

export default class TransactionResend extends PlatformCommand<typeof TransactionResend> {
  static summary = 'Re-deliver a past outbound transaction byte-for-byte, original control numbers preserved.'

  static description =
    "Asks the Tediware server to put the stored document on the partner's wire again; a standard API key is required. The resend is queued, and its delivery appears on the same trace as the original, marked as a resend."

  static examples = ['<%= config.bin %> transaction resend 8f14e45f-...']

  static args = {
    id: Args.string({description: 'Transaction id of the outbound document to re-deliver.', required: true}),
  }

  async run(): Promise<ResendReceipt> {
    const client = await this.getAuthedClient()
    const receipt = await client.transactionResend(this.requireId(this.args.id, 'transaction id'))
    // The server answers 202: the resend is queued, not yet delivered.
    this.log(`Resend queued for ${receipt.ediTransactionId}.`)
    if (receipt.traceGuid) {
      this.log(`  Trace ${receipt.traceGuid}`)
      this.log(`Follow it with: tedi trace ${receipt.traceGuid}`)
    }
    return receipt
  }
}
