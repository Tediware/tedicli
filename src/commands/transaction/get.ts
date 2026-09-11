import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {TransactionDetail} from '../../lib/platform.js'
import {TediError} from '../../lib/errors.js'
import {errorLines, roleLine} from '../../lib/render.js'
import {cell, formatTime} from '../../lib/table.js'

export default class TransactionGet extends PlatformCommand<typeof TransactionGet> {
  static summary = 'Show one EDI transaction: envelope, outcome, acknowledgment, and its own artifacts.'

  static description = `${SERVER_DATA}

Shows what the transaction page in the app shows, minus the logs (\`tedi transaction logs\`). For everything on the trace, including other documents that share it, use \`tedi trace\`.`

  static examples = [
    '<%= config.bin %> transaction get 8f14e45f-...',
    '<%= config.bin %> transaction get --trace 3995341c-...',
    '<%= config.bin %> transaction get 8f14e45f-... --json',
  ]

  static args = {
    id: Args.string({description: 'Transaction id (from `transaction list`, a receipt, or the dashboard).'}),
  }

  static flags = {
    trace: Flags.string({
      description: 'Look the transaction up by its trace GUID instead of its id (the trace must carry exactly one).',
      exclusive: ['id'],
    }),
  }

  async run(): Promise<TransactionDetail> {
    const client = await this.getAuthedClient()
    const id = await resolveTransactionId(client, this.args.id, this.flags.trace)
    const txn = await client.transactionGet(id)

    const lines: Array<[string, string]> = [
      ['Direction', txn.direction ?? (txn.incoming ? 'inbound' : 'outbound')],
      ['Transaction set', cell(txn.transactionSetIdentifier)],
      ['Partner', cell(txn.partnerKey)],
      ['Status', txn.status],
      ['Flow', cell(txn.flowName)],
      ['Sender', `${cell(txn.senderQualifier)} ${cell(txn.senderExtid)}`],
      ['Receiver', `${cell(txn.receiverQualifier)} ${cell(txn.receiverExtid)}`],
      ['Control numbers', `ISA ${cell(txn.interchangeControlNumber)} / GS ${cell(txn.groupControlNumber)} / ST ${cell(txn.transactionSetControlNumber)}`],
      ['Acknowledgment', txn.acknowledgmentStatus ?? 'n/a'],
      ['Trace', cell(txn.traceGuid)],
      ['Created', formatTime(txn.createdAt)],
    ]
    if (txn.acknowledges) lines.push(['Acknowledges', txn.acknowledges])
    if (txn.acknowledgedBy) lines.push(['Acknowledged by', txn.acknowledgedBy])
    if (txn.duplicateOf) lines.push(['Duplicate of', txn.duplicateOf])
    if (txn.resendCount > 0) lines.push(['Resent', `${txn.resendCount}x, last ${formatTime(txn.lastResentAt)}`])
    for (const [label, value] of lines) this.log(`${label.padEnd(16)}${value}`)

    // Payload bytes stay behind `artifact get`. The four roles are the
    // transaction's own: a 997 lists the document it acknowledges under
    // "acknowledged", never the trace's whole artifact pile.
    this.log('')
    this.log('Artifacts (fetch with `tedi artifact get <id>`):')
    this.log(roleLine('  Input', txn.artifacts?.input ?? null))
    this.log(roleLine('  Output', txn.artifacts?.output ?? null))
    this.log(roleLine('  Errored', txn.artifacts?.errored ?? null))
    this.log(roleLine('  Acknowledged', txn.artifacts?.acknowledged ?? null))

    const errored = txn.results.find((r) => r.status === 'error' || r.detail.errorMessage)
    if (errored) {
      this.log('')
      const [message, ...findings] = errorLines(errored.detail)
      this.log(`Error at ${cell(errored.nodeName)}: ${message ?? ''}`)
      for (const line of findings) this.log(line)
    }
    if (txn.traceErroredElsewhere) {
      this.log('')
      this.log(`Another document on this trace errored at ${cell(txn.traceErroredElsewhereNodeName)}. See: tedi trace ${txn.traceGuid}`)
    }

    return txn
  }
}

/**
 * The positional id, or the one transaction on `--trace`. Receipts hand back a
 * trace, so the guid has to be a way in; a trace carrying several documents
 * (an inbound 850 and the 997 answering it) is ambiguous, and `tedi trace`
 * lists them.
 */
export async function resolveTransactionId(
  client: {transactionList: (q: {trace: string; limit: number}) => Promise<{ediTransactions: {id: string; transactionSetIdentifier: string | null}[]}>},
  id: string | undefined,
  trace: string | undefined,
): Promise<string> {
  const cleanId = id?.trim() ?? ''
  const cleanTrace = trace?.trim() ?? ''
  if (cleanId && cleanTrace) throw new TediError('Pass a transaction id or --trace, not both.')
  if (cleanId) return cleanId
  if (!cleanTrace) {
    throw new TediError(id === undefined && trace === undefined ? 'A transaction id or --trace <guid> is required.' : 'The id is empty.', {
      suggestions: ['Ids appear in `tedi transaction list` and in the receipt from `tedi partner send`.'],
    })
  }

  const page = await client.transactionList({trace: cleanTrace, limit: 100})
  const rows = page.ediTransactions
  if (rows.length === 1) return rows[0]!.id
  if (rows.length === 0) {
    throw new TediError(`No transaction on trace '${cleanTrace}' in your organization.`, {
      exitCode: 1,
      suggestions: [`Run \`tedi trace ${cleanTrace}\` to see what the trace holds.`],
    })
  }
  throw new TediError(`Trace ${cleanTrace} carries ${rows.length} transactions; pass one of their ids.`, {
    suggestions: rows.map((r) => `${r.id} (${r.transactionSetIdentifier ?? '?'})`),
  })
}
