/**
 * Base class for the data-plane commands (`transaction`, `result`, `feed`,
 * `artifact`, `partner`, `trace`). Unlike the licensed reference, this is the
 * caller's own data, so every command here enables `--json` (oclif prints the
 * `run()` return value, which is the REST response unchanged) and the human
 * rendering is a courtesy on top.
 */

import {Command, Flags, Interfaces} from '@oclif/core'

import {BaseCommand} from './base-command.js'
import {TediError} from './lib/errors.js'
import {Pagination} from './lib/platform.js'

/** The one line every server-talking command opens its description with. */
export const SERVER_DATA = "Reads your organization's data from the Tediware server; a standard API key is required."

export abstract class PlatformCommand<T extends typeof Command> extends BaseCommand<T> {
  static enableJsonFlag = true

  protected declare flags: Interfaces.InferredFlags<(typeof PlatformCommand)['baseFlags'] & T['flags']>

  /** Cursor-pagination flags shared by every list command. */
  static paginationFlags = {
    limit: Flags.integer({
      description: 'Rows per page, 1 to 100.',
      min: 1,
      max: 100,
    }),
    cursor: Flags.string({
      description: 'Continue from a previous page (the nextCursor value).',
    }),
  }

  /** The direction filter, worded the same on every list that has one. */
  static directionFlag = Flags.option({
    options: ['inbound', 'outbound'] as const,
    description: 'Only inbound (received from a partner) or outbound (sent to a partner) documents.',
  })

  /** The `--since` filter, parsed by `parseSince` before it is sent. */
  static sinceFlag = Flags.string({
    description:
      'Only entries at or after this time: an ISO 8601 timestamp with a zone (2026-08-19T13:21:19Z), a bare date (UTC midnight), or a relative form (30m, 2h, 3d).',
  })

  /**
   * A reference id as typed, trimmed. An empty one never reaches the server:
   * `GET /platform/partners/` with nothing after the slash is the collection
   * route, and the answer to that is not the answer to any question asked.
   */
  protected requireId(raw: string | undefined, what: string): string {
    const id = (raw ?? '').trim()
    if (id === '') {
      throw new TediError(`The ${what} is empty.`, {
        suggestions: [`Pass a ${what}; they appear in list output, receipts and the dashboard.`],
      })
    }
    return id
  }

  /**
   * Print the human-mode "there is more" hint after a list. JSON mode carries
   * the pagination envelope instead, so callers script against nextCursor.
   */
  protected logPageHint(pagination: Pagination): void {
    if (pagination.hasMore && pagination.nextCursor) {
      this.log('')
      this.log(`More rows exist. Continue with --cursor ${pagination.nextCursor}`)
    }
  }
}
