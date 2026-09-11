import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ConnectionPage} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class ConnectionList extends PlatformCommand<typeof ConnectionList> {
  static summary = 'List your connections: kind, host, whether provisioned, and how many partners use each.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> connection list', '<%= config.bin %> connection list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<ConnectionPage> {
    const client = await this.getAuthedClient()
    const page = await client.connectionList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.connections.length === 0) {
      this.log('No connections in your organization.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'KIND', 'HOST', 'PROVISIONED', 'PARTNERS'],
        ...page.connections.map((c) => [
          c.id,
          c.name,
          c.kind,
          cell(c.host),
          c.provisioned ? 'yes' : 'no',
          String(c.partnerCount),
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
