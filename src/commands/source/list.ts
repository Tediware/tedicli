import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {SourcePage} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class SourceList extends PlatformCommand<typeof SourceList> {
  static summary = 'List your sources (sample JSON of what you send, one per shape) and the mappings reading each.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> source list', '<%= config.bin %> source list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<SourcePage> {
    const client = await this.getAuthedClient()
    const page = await client.sourceList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.sources.length === 0) {
      this.log('No sources in your organization.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'MAPPINGS'],
        ...page.sources.map((s) => [s.id, s.name, s.mappings.map((m) => m.name).join(', ') || '-']),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
