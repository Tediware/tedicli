import {Args, Flags} from '@oclif/core'

import {CodeLimit} from '../../lib/api-client.js'
import {wantsFullCodeList} from '../../lib/output.js'
import {X12Command} from '../../x12-base-command.js'

export default class X12Ele extends X12Command<typeof X12Ele> {
  // `element` keeps working but stays out of the help listing; `ele` is canonical.
  static hiddenAliases = ['x12:element']

  static description = 'Look up an X12 element, including its valid code list (e.g. 235).'

  static examples = [
    '<%= config.bin %> x12 ele 66',
    '<%= config.bin %> x12 ele 235 --format markdown',
    '<%= config.bin %> x12 ele 673 --all',
  ]

  static args = {
    id: Args.string({description: 'Element id, e.g. 66 (case-insensitive).', required: true}),
  }

  static flags = {
    all: Flags.boolean({
      description: 'Show every code, instead of the truncated console preview.',
      exclusive: ['limit'],
    }),
    limit: Flags.integer({
      description: 'Show at most this many codes. Console format only; markdown always shows every code.',
      min: 1,
      exclusive: ['all'],
    }),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest({codeLimit: this.codeLimit()})
    const client = await this.getAuthedClient()
    // Accept whatever case the user types (element ids are numeric, but be consistent).
    const doc = await client.x12Element(this.args.id.toUpperCase(), req)
    this.printReference(doc)
  }

  /**
   * How many codes to ask for: what the user said, or — when they said nothing
   * and stdout is not a terminal — everything.
   *
   * The implicit case is the one worth explaining. A truncated list ends in a
   * footer inviting a second lookup, which is useful to a reader at a prompt and
   * useless to a pipe, a file, or a script: it spends a round trip that whatever
   * is consuming the output cannot make. `--limit` still wins if a caller
   * genuinely wants the short list on the other end of a pipe.
   */
  private codeLimit(): CodeLimit | undefined {
    if (this.flags.all) return 'all'
    if (this.flags.limit !== undefined) return this.flags.limit
    return wantsFullCodeList(this.flags.format) ? 'all' : undefined
  }
}
