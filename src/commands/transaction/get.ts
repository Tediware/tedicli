import {Args} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {TransactionDetail} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class TransactionGet extends PlatformCommand<typeof TransactionGet> {
  static description =
    'Show one EDI transaction: envelope, processing outcome, and the stored artifacts on its trace.'

  static examples = [
    '<%= config.bin %> transaction get 8f14e45f-...',
    '<%= config.bin %> transaction get 8f14e45f-... --json',
  ]

  static args = {
    id: Args.string({description: 'Transaction id (from `transaction list` or the dashboard).', required: true}),
  }

  async run(): Promise<TransactionDetail> {
    const client = await this.getAuthedClient()
    const txn = await client.transactionGet(this.args.id)

    const lines: Array<[string, string]> = [
      ['Direction', txn.incoming ? 'inbound' : 'outbound'],
      ['Transaction set', cell(txn.transactionSetIdentifier)],
      ['Status', txn.status],
      ['Flow', cell(txn.flowName)],
      ['Sender', `${cell(txn.senderQualifier)} ${cell(txn.senderExtid)}`],
      ['Receiver', `${cell(txn.receiverQualifier)} ${cell(txn.receiverExtid)}`],
      ['Control numbers', `ISA ${cell(txn.interchangeControlNumber)} / GS ${cell(txn.groupControlNumber)} / ST ${cell(txn.transactionSetControlNumber)}`],
      ['Acknowledgment', cell(txn.acknowledgmentStatus)],
      ['Trace', cell(txn.traceGuid)],
      ['Created', txn.createdAt],
    ]
    if (txn.resendCount > 0) lines.push(['Resent', `${txn.resendCount}x, last ${cell(txn.lastResentAt)}`])
    for (const [label, value] of lines) this.log(`${label.padEnd(16)}${value}`)

    // Payload bytes stay behind `artifact get`: a 997 transaction carries two
    // EDI artifacts (the 997 and the document it acknowledged), so the listing
    // is labeled rather than guessing which one the caller means.
    const artifacts = txn.results.flatMap((r) => r.detail.artifacts ?? [])
    if (artifacts.length > 0) {
      this.log('')
      this.log('Artifacts (fetch with `tedi artifact get <id>`):')
      this.log(
        renderTable([
          ['ID', 'USAGE', 'TYPE', 'FILENAME'],
          ...artifacts.map((a) => [a.id, a.usage, cell(a.contentType), cell(a.filename)]),
        ]),
      )
    }

    const errored = txn.results.find((r) => r.detail.errorMessage)
    if (errored) {
      this.log('')
      this.log(`Error at ${cell(errored.nodeName)}: ${errored.detail.errorMessage}`)
    }

    return txn
  }
}
