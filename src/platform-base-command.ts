/**
 * Base class for the data-plane commands (`transaction`, `result`, `feed`,
 * `artifact`, `partner`). Unlike the licensed reference, this is the caller's
 * own data, so every command here enables `--json` (oclif prints the `run()`
 * return value) and the human rendering is a courtesy on top.
 */

import {Command, Flags, Interfaces} from '@oclif/core'

import {BaseCommand} from './base-command.js'
import {Page} from './lib/platform.js'

export abstract class PlatformCommand<T extends typeof Command> extends BaseCommand<T> {
  static enableJsonFlag = true

  protected declare flags: Interfaces.InferredFlags<(typeof PlatformCommand)['baseFlags'] & T['flags']>

  /** Cursor-pagination flags shared by every list command. */
  static paginationFlags = {
    limit: Flags.integer({
      description: 'Rows per page (server caps at 100).',
      min: 1,
    }),
    cursor: Flags.string({
      description: 'Continue from a previous page (the nextCursor value).',
    }),
  }

  /**
   * Print the human-mode "there is more" hint after a list. JSON mode carries
   * the pagination envelope instead, so callers script against nextCursor.
   */
  protected logPageHint(page: Page<unknown>): void {
    if (page.hasMore && page.nextCursor) {
      this.log('')
      this.log(`More rows exist. Continue with --cursor ${page.nextCursor}`)
    }
  }
}
