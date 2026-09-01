import {Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {RateLimitedError} from '../../lib/errors.js'
import {FeedEntry, Page} from '../../lib/platform.js'
import {cell, renderTable, shortTime} from '../../lib/table.js'

/** How often `--follow` polls. The server withholds rows younger than 2s, so
 * polling much faster than this buys nothing. */
const FOLLOW_INTERVAL_MS = 5000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default class FeedList extends PlatformCommand<typeof FeedList> {
  static description = 'List the feed of deliverable documents and errors, oldest first. --follow tails it.'

  static examples = [
    '<%= config.bin %> feed list',
    '<%= config.bin %> feed list --status error --partner ACME',
    '<%= config.bin %> feed list --follow',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    direction: Flags.string({description: 'Filter by direction.', options: ['inbound', 'outbound']}),
    status: Flags.string({description: 'Filter by outcome.', options: ['success', 'error']}),
    partner: Flags.string({description: 'Filter by partner key.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    since: Flags.string({description: 'Only entries at or after this ISO 8601 timestamp.'}),
    follow: Flags.boolean({
      char: 'f',
      description: 'Keep polling and print new entries as they arrive (Ctrl+C to stop).',
      exclusive: ['cursor'],
    }),
  }

  async run(): Promise<Page<FeedEntry>> {
    const client = await this.getAuthedClient()
    // A follow with no start point tails from now: replaying the org's whole
    // retained history at request speed would flood the terminal and the rate
    // limit before ever reaching the present. --since or --cursor override.
    const since =
      this.flags.follow && !this.flags.since && !this.flags.cursor ? new Date().toISOString() : this.flags.since
    const query = {
      direction: this.flags.direction,
      status: this.flags.status,
      partner: this.flags.partner,
      trace: this.flags.trace,
      since,
      limit: this.flags.limit,
    }

    let page = await client.feedList({...query, cursor: this.flags.cursor})
    this.printEntries(page.items, true)

    if (!this.flags.follow) {
      this.logPageHint(page)
      return page
    }

    // Tail loop: the feed is ascending and an empty page echoes the cursor, so
    // "everything after where I stopped" is one request per tick. Runs until
    // interrupted; in --json mode each new entry prints as its own line.
    let cursor = page.nextCursor
    for (;;) {
      // Drain any backlog before sleeping, so a burst is not paced one page per tick.
      if (!page.hasMore) await sleep(FOLLOW_INTERVAL_MS)
      try {
        page = await client.feedList({...query, cursor: cursor ?? undefined})
      } catch (err) {
        // A throttled tail waits the server's Retry-After out and resumes;
        // dying on a 429 would make every long-lived tail eventually fatal.
        // Anything else still ends the tail.
        if (!(err instanceof RateLimitedError)) throw err
        await sleep(Math.max((err.retryAfterSeconds ?? 0) * 1000, FOLLOW_INTERVAL_MS))
        page = {items: [], hasMore: false, nextCursor: cursor}
        continue
      }

      this.printEntries(page.items, false)
      cursor = page.nextCursor ?? cursor
    }
  }

  private printEntries(entries: FeedEntry[], first: boolean): void {
    if (entries.length === 0) {
      if (first && !this.flags.follow) this.log('No feed entries match.')
      return
    }

    if (this.jsonEnabled()) {
      // In follow mode a single JSON document can never finish, so emit one
      // entry per line (JSONL). Written straight to stdout because oclif
      // silences this.log under --json.
      if (this.flags.follow) for (const e of entries) process.stdout.write(`${JSON.stringify(e)}\n`)
      return
    }

    const rows = entries.map((e) => [
      shortTime(e.createdAt),
      e.direction,
      e.status,
      cell(e.partnerKey),
      cell(e.traceGuid),
    ])
    if (first) rows.unshift(['CREATED', 'DIR', 'STATUS', 'PARTNER', 'TRACE'])
    this.log(renderTable(rows))
  }
}
