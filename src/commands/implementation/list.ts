import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ImplementationPage} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class ImplementationList extends PlatformCommand<typeof ImplementationList> {
  static summary = 'List your own implementations: transaction set, release, status, and where each was copied from.'

  static description = `${SERVER_DATA}

Public implementations are not listed. Import one in the app first; it is then yours and appears here.`

  static examples = [
    '<%= config.bin %> implementation list',
    '<%= config.bin %> implementation list --set 850',
    '<%= config.bin %> implementation list --json',
  ]

  static flags = {
    set: Flags.string({description: 'Only implementations of this transaction set code, for example 850.'}),
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<ImplementationPage> {
    const client = await this.getAuthedClient()
    const page = await client.implementationList({
      transactionSetIdentifier: this.flags.set,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.implementations.length === 0) {
      this.log('No implementations match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'SET', 'RELEASE', 'VERSION', 'STATUS', 'SEGMENTS', 'LOOPS', 'COPIED FROM'],
        ...page.implementations.map((i) => [
          i.id,
          i.name,
          i.transactionSet.identifier,
          i.transactionSet.release,
          cell(i.version),
          cell(i.status),
          String(i.segmentUseCount),
          String(i.loopUseCount),
          i.sourceImplementation?.name ?? '-',
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
