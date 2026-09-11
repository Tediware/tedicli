import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../platform-base-command.js'
import {TraceDetail} from '../lib/platform.js'
import {errorLines, firstLine, traceArtifactTable} from '../lib/render.js'
import {cell, formatTime, renderTable} from '../lib/table.js'

export default class Trace extends PlatformCommand<typeof Trace> {
  static summary = 'Show everything on one trace: its transactions, results by node, feed entries, artifacts and logs.'

  static description = `${SERVER_DATA}

The trace GUID is what every receipt hands back, and this is the one command to follow it with. PROCESSING says whether the pipeline is still running; poll until it is no. Logs appear a few seconds after they are written.`

  static examples = [
    '<%= config.bin %> trace 3995341c-...',
    '<%= config.bin %> trace 3995341c-... --no-logs',
    '<%= config.bin %> trace 3995341c-... --json',
  ]

  static args = {
    guid: Args.string({description: 'Trace GUID (from a receipt, a transaction, a result or a feed entry).', required: true}),
  }

  static flags = {
    logs: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Include the logs. --no-logs for the shorter view.',
    }),
  }

  async run(): Promise<TraceDetail> {
    const guid = this.requireId(this.args.guid, 'trace GUID')

    const client = await this.getAuthedClient()
    const trace = await client.traceGet(guid)

    this.log(`Trace       ${trace.traceGuid}`)
    this.log(`Processing  ${trace.processing ? 'yes (still running)' : 'no'}`)

    this.log('')
    this.log('Transactions:')
    if (trace.ediTransactions.length === 0) this.log('  (none yet)')
    else {
      this.log(
        renderTable([
          ['ID', 'DIRECTION', 'SET', 'PARTNER', 'ICN', 'ACK', 'CREATED'],
          ...trace.ediTransactions.map((t) => [
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
    }

    this.log('')
    this.log('Results (in order):')
    if (trace.results.length === 0) this.log('  (none)')
    else {
      this.log(
        renderTable([
          ['CREATED', 'NODE', 'STATUS', 'ID', 'ERROR'],
          ...trace.results.map((r) => [
            formatTime(r.createdAt),
            cell(r.nodeName) + (r.detail.resend ? ' (resend)' : ''),
            r.status ?? (r.detail.errorMessage ? 'error' : 'success'),
            r.id,
            firstLine(r.detail.errorMessage) || '-',
          ]),
        ]),
      )
      for (const r of trace.results) {
        if (r.status !== 'error' || !r.detail.errors?.length) continue
        this.log('')
        this.log(`Error at ${cell(r.nodeName)}:`)
        for (const line of errorLines(r.detail)) this.log(`  ${line}`)
      }
    }

    this.log('')
    this.log('Feed:')
    if (trace.feedEntries.length === 0) this.log('  (none)')
    else {
      this.log(
        renderTable([
          ['CREATED', 'DIRECTION', 'STATUS', 'PARTNER', 'RESULT'],
          ...trace.feedEntries.map((f) => [formatTime(f.createdAt), f.direction, f.status, cell(f.partnerKey), cell(f.resultId)]),
        ]),
      )
    }

    this.log('')
    const artifacts = traceArtifactTable(trace.artifacts)
    if (artifacts.length === 0) this.log('Artifacts: none')
    else for (const line of artifacts) this.log(line)

    if (this.flags.logs) {
      this.log('')
      this.log('Logs:')
      if (trace.logs.length === 0) this.log('  (none yet)')
      for (const line of trace.logs) {
        this.log(`  ${formatTime(line.createdAt)}  ${line.level.padEnd(5)}  ${cell(line.nodeName)}  ${line.message}`)
      }
    }

    return trace
  }
}
