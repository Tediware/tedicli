import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {TransactionPage} from '../../lib/platform.js'
import {cell, formatTime, renderTable} from '../../lib/table.js'

export default class TransactionList extends PlatformCommand<typeof TransactionList> {
  static summary = "List your organization's EDI transactions, newest first."

  static description = `${SERVER_DATA}

ACK is the acknowledgment the partner sent back: accepted, rejected, unacknowledged (one is expected and has not arrived), or n/a (none is expected: inbound documents and 997s).`

  static examples = [
    '<%= config.bin %> transaction list',
    '<%= config.bin %> transaction list --direction outbound --ack unacknowledged',
    '<%= config.bin %> transaction list --partner ACME --set 850 --json',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    direction: PlatformCommand.directionFlag(),
    set: Flags.string({description: 'Filter by transaction set (e.g. 850).'}),
    ts: Flags.string({hidden: true}),
    partner: Flags.string({description: 'Filter by partner key.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    ack: Flags.string({
      description:
        'Filter by acknowledgment status. acknowledged means accepted or rejected; unacknowledged means one is expected and has not arrived.',
      options: ['accepted', 'rejected', 'acknowledged', 'unacknowledged'],
    }),
  }

  async run(): Promise<TransactionPage> {
    const client = await this.getAuthedClient()
    const page = await client.transactionList({
      direction: this.flags.direction,
      transactionSetIdentifier: this.flags.set ?? this.flags.ts,
      partner: this.flags.partner,
      trace: this.flags.trace,
      ackStatus: this.flags.ack,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.ediTransactions.length === 0) {
      this.log('No transactions match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'DIRECTION', 'SET', 'PARTNER', 'ICN', 'ACK', 'CREATED'],
        ...page.ediTransactions.map((t) => [
          t.id,
          t.direction ?? (t.incoming ? 'inbound' : 'outbound'),
          cell(t.transactionSetIdentifier),
          cell(t.partnerKey),
          cell(t.interchangeControlNumber),
          t.acknowledgmentStatus ?? 'n/a',
          formatTime(t.createdAt),
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
