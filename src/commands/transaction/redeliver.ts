import {Args} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {ResendReceipt} from '../../lib/platform.js'

export default class TransactionRedeliver extends PlatformCommand<typeof TransactionRedeliver> {
  static summary = 'Deliver a past inbound transaction to its destination again, without re-submitting the EDI.'

  static description =
    "Asks the Tediware server to repeat the inbound delivery (your webhook, or an upload) from the stored result; a standard API key is required. Nothing is re-parsed and no new transaction is created. The webhook body carries the same resultId as before, so a receiver that already processed it can skip it. The redelivery is queued, and appears on the same trace as the original, marked as a resend."

  static examples = ['<%= config.bin %> transaction redeliver 8f14e45f-...']

  static args = {
    id: Args.string({description: 'Transaction id of the inbound document to redeliver.', required: true}),
  }

  async run(): Promise<ResendReceipt> {
    const client = await this.getAuthedClient()
    const receipt = await client.transactionRedeliver(this.requireId(this.args.id, 'transaction id'))
    // The server answers 202: the redelivery is queued, not yet delivered.
    this.log(`Redelivery queued for ${receipt.ediTransactionId}.`)
    if (receipt.traceGuid) {
      this.log(`  Trace ${receipt.traceGuid}`)
      this.log(`Follow it with: tedi trace ${receipt.traceGuid}`)
    }
    return receipt
  }
}
