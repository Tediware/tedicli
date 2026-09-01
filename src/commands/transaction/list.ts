import {Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {Page, TransactionSummary} from '../../lib/platform.js'
import {cell, renderTable, shortTime} from '../../lib/table.js'

export default class TransactionList extends PlatformCommand<typeof TransactionList> {
  static description = "List your organization's EDI transactions, newest first."

  static examples = [
    '<%= config.bin %> transaction list',
    '<%= config.bin %> transaction list --outgoing --ack unacknowledged',
    '<%= config.bin %> transaction list --ts 850 --json',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    incoming: Flags.boolean({description: 'Only documents received from partners.', exclusive: ['outgoing']}),
    outgoing: Flags.boolean({description: 'Only documents sent to partners.', exclusive: ['incoming']}),
    ts: Flags.string({description: 'Filter by transaction set (e.g. 850).'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    ack: Flags.string({
      description: 'Filter by acknowledgment status.',
      options: ['accepted', 'rejected', 'acknowledged', 'unacknowledged'],
    }),
  }

  async run(): Promise<Page<TransactionSummary>> {
    const client = await this.getAuthedClient()
    const page = await client.transactionList({
      incoming: this.flags.incoming ? true : this.flags.outgoing ? false : undefined,
      transactionSetIdentifier: this.flags.ts,
      trace: this.flags.trace,
      ackStatus: this.flags.ack,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.items.length === 0) {
      this.log('No transactions match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'DIR', 'SET', 'ICN', 'ACK', 'CREATED'],
        ...page.items.map((t) => [
          t.id,
          t.incoming ? 'in' : 'out',
          cell(t.transactionSetIdentifier),
          cell(t.interchangeControlNumber),
          cell(t.acknowledgmentStatus),
          shortTime(t.createdAt),
        ]),
      ]),
    )
    this.logPageHint(page)
    return page
  }
}
