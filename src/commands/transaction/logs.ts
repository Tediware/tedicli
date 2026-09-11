import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {LogPage} from '../../lib/platform.js'
import {cell, formatTime} from '../../lib/table.js'
import {TediError} from '../../lib/errors.js'
import {parseSince} from '../../lib/time.js'
import {resolveTransactionId} from './get.js'

export default class TransactionLogs extends PlatformCommand<typeof TransactionLogs> {
  static summary = "Show a transaction's processing logs, oldest first."

  static description = `${SERVER_DATA}

Logs are kept per trace, so --trace reads them directly; a transaction id is resolved to its trace first. Lines appear a few seconds after they are written, so a trace still processing may show fewer lines than it will.`

  static examples = [
    '<%= config.bin %> transaction logs 8f14e45f-...',
    '<%= config.bin %> transaction logs --trace 3995341c-... --level error',
    '<%= config.bin %> transaction logs 8f14e45f-... --since 2h',
  ]

  static args = {
    id: Args.string({description: 'Transaction id whose trace to read.'}),
  }

  static flags = {
    ...PlatformCommand.paginationFlags,
    trace: Flags.string({description: 'Read the logs of this trace GUID instead of resolving a transaction id.'}),
    level: Flags.string({
      description: 'Only lines at this level.',
      options: ['info', 'warn', 'error'],
    }),
    since: PlatformCommand.sinceFlag,
  }

  async run(): Promise<LogPage> {
    const client = await this.getAuthedClient()
    let trace = this.flags.trace?.trim()
    if (!trace) {
      // Logs are keyed by trace, so resolve the transaction first. This also
      // makes an unknown id a proper "no transaction" instead of an empty log.
      const id = await resolveTransactionId(client, this.args.id, undefined)
      const txn = await client.transactionGet(id)
      if (!txn.traceGuid) throw new TediError(`Transaction ${id} has no trace, so there are no logs to read.`)
      trace = txn.traceGuid
    } else if (this.args.id?.trim()) {
      throw new TediError('Pass a transaction id or --trace, not both.')
    }

    const page = await client.logList({
      trace,
      level: this.flags.level,
      since: this.flags.since === undefined ? undefined : parseSince(this.flags.since),
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.logs.length === 0) {
      this.log('No log lines match.')
      return page
    }

    for (const line of page.logs) {
      this.log(`${formatTime(line.createdAt)}  ${line.level.padEnd(5)}  ${cell(line.nodeName)}  ${line.message}`)
    }

    this.logPageHint(page.pagination)
    return page
  }
}
