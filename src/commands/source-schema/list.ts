import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {SourceSchemaPage} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class SourceSchemaList extends PlatformCommand<typeof SourceSchemaList> {
  static summary = 'List your source schemas (the declared shapes of the JSON you send) and the mappings reading each.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> source-schema list', '<%= config.bin %> source-schema list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<SourceSchemaPage> {
    const client = await this.getAuthedClient()
    const page = await client.sourceSchemaList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.sourceSchemas.length === 0) {
      this.log('No source schemas in your organization.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'MAPPINGS'],
        ...page.sourceSchemas.map((s) => [s.id, s.name, s.mappings.map((m) => m.name).join(', ') || '-']),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
