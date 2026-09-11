import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {MappingPage} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class MappingList extends PlatformCommand<typeof MappingList> {
  static summary = 'List your mappings: direction, the implementation and source each targets, version, and the partners using it.'

  static description = SERVER_DATA

  static examples = [
    '<%= config.bin %> mapping list',
    '<%= config.bin %> mapping list --direction outbound --partner ACME',
    '<%= config.bin %> mapping list --json',
  ]

  static flags = {
    direction: PlatformCommand.directionFlag(),
    partner: Flags.string({description: 'Only mappings used by this partner (key, case-insensitive).'}),
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<MappingPage> {
    const client = await this.getAuthedClient()
    const page = await client.mappingList({
      direction: this.flags.direction,
      partner: this.flags.partner,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.mappings.length === 0) {
      this.log('No mappings match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'DIRECTION', 'IMPLEMENTATION', 'SOURCE', 'VERSION', 'PLACEHOLDERS', 'PARTNERS'],
        ...page.mappings.map((m) => [
          m.id,
          m.name,
          m.direction,
          m.implementation?.name ?? '-',
          m.source?.name ?? '-',
          m.currentVersion === null ? '-' : String(m.currentVersion),
          String(m.placeholderCount),
          m.partners.join(',') || '-',
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
