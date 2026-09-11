import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ResultPage} from '../../lib/platform.js'
import {cell, formatTime, renderTable} from '../../lib/table.js'

export default class ResultList extends PlatformCommand<typeof ResultList> {
  static summary = 'List processing results, newest first.'

  static description = `${SERVER_DATA}

A result is one node's work on one document. Its direction (in --json) is the node's transfer direction, not the document's; filter documents by direction on \`tedi transaction list\` or \`tedi feed list\`.`

  static examples = [
    '<%= config.bin %> result list',
    '<%= config.bin %> result list --status error',
    '<%= config.bin %> result list --trace 4d0e9f5a-... --json',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    node: Flags.string({description: 'Filter by node: its name (as shown in NODE) or its id.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
    status: Flags.option({
      options: ['success', 'error'] as const,
      description: 'Only results that succeeded, or only ones that recorded an error.',
    })(),
  }

  async run(): Promise<ResultPage> {
    const client = await this.getAuthedClient()
    const page = await client.resultList({
      node: this.flags.node,
      trace: this.flags.trace,
      status: this.flags.status,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.results.length === 0) {
      this.log('No results match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NODE', 'STATUS', 'PARTNER', 'TRACE', 'CREATED'],
        ...page.results.map((r) => [
          r.id,
          cell(r.nodeName),
          r.status ?? (r.detail.errorMessage ? 'error' : 'success'),
          cell(r.detail.partner?.key),
          cell(r.traceGuid),
          formatTime(r.createdAt),
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
