import {Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {Page, PlatformResult} from '../../lib/platform.js'
import {cell, renderTable, shortTime} from '../../lib/table.js'

export default class ResultList extends PlatformCommand<typeof ResultList> {
  static description = 'List processing results, newest first.'

  static examples = [
    '<%= config.bin %> result list',
    '<%= config.bin %> result list --trace 4d0e9f5a-... --json',
  ]

  static flags = {
    ...PlatformCommand.paginationFlags,
    node: Flags.string({description: 'Filter by node id.'}),
    trace: Flags.string({description: 'Filter by trace GUID.'}),
  }

  async run(): Promise<Page<PlatformResult>> {
    const client = await this.getAuthedClient()
    const page = await client.resultList({
      node: this.flags.node,
      trace: this.flags.trace,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.items.length === 0) {
      this.log('No results match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NODE', 'DIR', 'TRACE', 'CREATED'],
        ...page.items.map((r) => [
          r.id,
          cell(r.nodeName),
          cell(r.detail.direction),
          cell(r.traceGuid),
          shortTime(r.createdAt),
        ]),
      ]),
    )
    this.logPageHint(page)
    return page
  }
}
