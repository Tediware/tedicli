import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {TransactionPage} from '../../lib/platform.js'
import {statusCell} from '../../lib/render.js'
import {cell, formatTime, renderTable} from '../../lib/table.js'

export default class TransactionList extends PlatformCommand<typeof TransactionList> {
  static summary = "List your organization's EDI transactions, newest first."

  static description = `${SERVER_DATA}

STATUS is processing until the document's run records its first result, error when a result on the run recorded a failure, and delivered otherwise. A warning count beside it counts the non-fatal notes the run raised; warnings are their own axis and never change the status, so a delivered document that raised one still reads delivered. ACK is the acknowledgment the partner sent back: accepted, rejected, unacknowledged (a delivered document is waiting on one), or n/a (none is expected: inbound documents, 997s, and documents that never went out).`

  static examples = [
    '<%= config.bin %> transaction list',
    '<%= config.bin %> transaction list --direction outbound --ack unacknowledged',
    '<%= config.bin %> transaction list --status error',
    '<%= config.bin %> transaction list --warnings',
    '<%= config.bin %> transaction list --partner ACME --set 850 --json',
    '<%= config.bin %> transaction list --status error --limit 100 --json --compact',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    direction: PlatformCommand.directionFlag(),
    set: Flags.string({description: 'Filter by transaction set (e.g. 850).'}),
    ts: Flags.string({hidden: true}),
    partner: Flags.string({description: 'Filter by partner key.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    status: Flags.string({
      description: 'Filter by processing status.',
      options: ['delivered', 'error', 'processing'],
    }),
    ack: Flags.string({
      description:
        'Filter by acknowledgment status. acknowledged means accepted or rejected; unacknowledged means a delivered document is still waiting on one.',
      options: ['accepted', 'rejected', 'acknowledged', 'unacknowledged'],
    }),
    warnings: Flags.boolean({
      allowNo: true,
      description: 'Only documents that raised warnings; --no-warnings for only the ones that raised none. Omit for both.',
    }),
    compact: PlatformCommand.compactFlag,
  }

  async run(): Promise<TransactionPage> {
    const client = await this.getAuthedClient()
    const page = await client.transactionList({
      direction: this.flags.direction,
      transactionSetIdentifier: this.flags.set ?? this.flags.ts,
      partner: this.flags.partner,
      trace: this.flags.trace,
      ackStatus: this.flags.ack,
      status: this.flags.status,
      warnings: this.flags.warnings,
      compact: this.wantsCompact(this.flags.compact),
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.ediTransactions.length === 0) {
      this.log('No transactions match.')
      return page
    }

    // Compact rows lack the fields the table reads; --json prints the return value.
    if (this.jsonEnabled()) return page

    this.log(
      renderTable([
        ['ID', 'DIRECTION', 'SET', 'PARTNER', 'ICN', 'STATUS', 'ACK', 'CREATED'],
        ...page.ediTransactions.map((t) => [
          t.id,
          t.direction ?? (t.incoming ? 'inbound' : 'outbound'),
          cell(t.transactionSetIdentifier),
          cell(t.partnerKey),
          cell(t.interchangeControlNumber),
          statusCell(t.status, t.warningCount),
          t.acknowledgmentStatus ?? 'n/a',
          formatTime(t.createdAt),
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
