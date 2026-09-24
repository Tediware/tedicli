import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {RateLimitedError} from '../../lib/errors.js'
import {FeedEntry, FeedPage} from '../../lib/platform.js'
import {firstLine} from '../../lib/render.js'
import {cell, columnWidths, formatTime, renderTable} from '../../lib/table.js'
import {parseSince} from '../../lib/time.js'

/** How often `--follow` polls. The server withholds rows younger than 2s, so
 * polling much faster than this buys nothing. */
const FOLLOW_INTERVAL_MS = 5000

/** The window a bare `feed list` shows. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Column widths for `--follow`, where rows arrive in batches under one header
 * and cannot be measured up front: a timestamp, the two enums, and generous
 * room for a partner key. The trace is last and unpadded.
 */
const FOLLOW_WIDTHS = [20, 9, 7, 16]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default class FeedList extends PlatformCommand<typeof FeedList> {
  static summary = 'List the feed of delivered documents and errors, oldest first. --follow tails it.'

  static description = `${SERVER_DATA}

Without --since or --cursor the last 24 hours are shown. Error rows print the first line of the error and the result id underneath; \`tedi result get <id>\` has the rest.`

  static examples = [
    '<%= config.bin %> feed list',
    '<%= config.bin %> feed list --status error --partner ACME --since 3d',
    '<%= config.bin %> feed list --follow',
    '<%= config.bin %> feed list --status error --since 7d --json --compact',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    direction: PlatformCommand.directionFlag(),
    status: Flags.option({
      options: ['success', 'error'] as const,
      description: 'Only delivered documents, or only errors.',
    })(),
    partner: Flags.string({description: 'Filter by partner key.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    since: PlatformCommand.sinceFlag,
    follow: Flags.boolean({
      char: 'f',
      description: 'Keep polling and print new entries as they arrive (Ctrl+C to stop).',
      exclusive: ['cursor', 'limit'],
    }),
    compact: PlatformCommand.compactFlag,
  }

  async run(): Promise<FeedPage> {
    const client = await this.getAuthedClient()
    // A follow with no start point tails from just before now: replaying the
    // org's whole retained history at request speed would flood the terminal
    // and the rate limit before ever reaching the present, and starting a poll
    // interval back covers the rows the server was still withholding at the
    // first request. A plain list with no start point shows the last day,
    // unless it names a trace, which is a specific thing whenever it happened.
    // --since or --cursor override all of it.
    let since = this.flags.since === undefined ? undefined : parseSince(this.flags.since)
    let defaulted = false
    if (since === undefined && !this.flags.cursor) {
      if (this.flags.follow) since = new Date(Date.now() - FOLLOW_INTERVAL_MS).toISOString()
      else if (!this.flags.trace) {
        since = new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString()
        defaulted = true
      }
    }
    const query = {
      direction: this.flags.direction,
      status: this.flags.status,
      partner: this.flags.partner,
      trace: this.flags.trace,
      since,
      compact: this.wantsCompact(this.flags.compact),
      limit: this.flags.limit,
    }

    if (this.flags.follow) {
      // Stderr so JSONL on stdout stays clean, and so an idle tail and a hung
      // one no longer look the same.
      process.stderr.write(`Following from ${formatTime(since)}, polling every ${FOLLOW_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`)
    }

    let page = await client.feedList({...query, cursor: this.flags.cursor})
    this.printEntries(page.feedEntries, true)

    if (!this.flags.follow) {
      if (defaulted && !this.jsonEnabled()) {
        this.log('')
        this.log(`Showing the last 24 hours (since ${formatTime(since)}). Pass --since for a different window.`)
      }
      this.logPageHint(page.pagination)
      return page
    }

    // Tail loop: the feed is ascending and an empty page echoes the cursor, so
    // "everything after where I stopped" is one request per tick. Runs until
    // interrupted; in --json mode each new entry prints as its own line.
    let cursor = page.pagination.nextCursor
    for (;;) {
      // Drain any backlog before sleeping, so a burst is not paced one page per tick.
      if (!page.pagination.hasMore) await sleep(FOLLOW_INTERVAL_MS)
      try {
        page = await client.feedList({...query, cursor: cursor ?? undefined})
      } catch (err) {
        // A throttled tail waits the server's Retry-After out and resumes;
        // dying on a 429 would make every long-lived tail eventually fatal.
        // Anything else still ends the tail.
        if (!(err instanceof RateLimitedError)) throw err
        await sleep(Math.max((err.retryAfterSeconds ?? 0) * 1000, FOLLOW_INTERVAL_MS))
        page = {feedEntries: [], pagination: {hasMore: false, nextCursor: cursor}}
        continue
      }

      this.printEntries(page.feedEntries, false)
      cursor = page.pagination.nextCursor ?? cursor
    }
  }

  private printEntries(entries: FeedEntry[], first: boolean): void {
    if (this.jsonEnabled()) {
      // In follow mode a single JSON document can never finish, so emit one
      // entry per line (JSONL). Written straight to stdout because oclif
      // silences this.log under --json.
      if (this.flags.follow) for (const e of entries) process.stdout.write(`${JSON.stringify(e)}\n`)
      return
    }

    if (entries.length === 0) {
      if (first && !this.flags.follow) this.log('No feed entries match.')
      return
    }

    const header = ['CREATED', 'DIRECTION', 'STATUS', 'PARTNER', 'TRACE']
    const row = (e: FeedEntry) => [formatTime(e.createdAt), e.direction, e.status, cell(e.partnerKey), cell(e.traceGuid)]
    // A tail cannot measure rows it has not seen, so it uses fixed widths;
    // a one-shot list measures the page it has.
    const widths = this.flags.follow ? FOLLOW_WIDTHS : columnWidths([header, ...entries.map(row)])
    if (first) this.log(renderTable([header], widths))
    for (const e of entries) {
      this.log(renderTable([row(e)], widths))
      if (e.status === 'error') {
        const message = firstLine(e.detail.errorMessage)
        this.log(`    ${message || 'error'}${e.resultId ? `  (result ${e.resultId})` : ''}`)
      }
    }
  }
}
