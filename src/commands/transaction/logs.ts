import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {LogLine, Page} from '../../lib/platform.js'
import {cell, shortTime} from '../../lib/table.js'
import {TediError} from '../../lib/errors.js'

export default class TransactionLogs extends PlatformCommand<typeof TransactionLogs> {
  static description = "Show a transaction's processing logs, oldest first."

  static examples = [
    '<%= config.bin %> transaction logs 8f14e45f-...',
    '<%= config.bin %> transaction logs 8f14e45f-... --level error',
  ]

  static args = {
    id: Args.string({description: 'Transaction id whose trace to read.', required: true}),
  }

  static flags = {
    ...PlatformCommand.paginationFlags,
    level: Flags.string({
      description: 'Only lines at this level.',
      options: ['info', 'warn', 'error'],
    }),
    since: Flags.string({description: 'Only lines at or after this ISO 8601 timestamp.'}),
  }

  async run(): Promise<Page<LogLine>> {
    const client = await this.getAuthedClient()
    // Logs are keyed by trace, so resolve the transaction first. This also
    // makes an unknown id a proper "no transaction" instead of an empty log.
    const txn = await client.transactionGet(this.args.id)
    if (!txn.traceGuid) {
      throw new TediError(`Transaction ${this.args.id} has no trace, so there are no logs to read.`)
    }

    const page = await client.logList({
      trace: txn.traceGuid,
      level: this.flags.level,
      since: this.flags.since,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.items.length === 0) {
      this.log('No log lines match.')
      return page
    }

    for (const line of page.items) {
      this.log(`${shortTime(line.createdAt)}  ${line.level.padEnd(5)}  ${cell(line.nodeName)}  ${line.message}`)
    }

    this.logPageHint(page)
    return page
  }
}
