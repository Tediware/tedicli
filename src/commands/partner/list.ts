import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {PartnerPage} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class PartnerList extends PlatformCommand<typeof PartnerList> {
  static summary = 'List your trading partners: key, connection, and the transaction sets each takes.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> partner list', '<%= config.bin %> partner list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<PartnerPage> {
    const client = await this.getAuthedClient()
    const page = await client.partnerList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.partners.length === 0) {
      this.log('No partners in your organization.')
      return page
    }

    this.log(
      renderTable([
        ['KEY', 'NAME', 'CONNECTION', 'INBOUND', 'OUTBOUND', 'FLOWS'],
        ...page.partners.map((p) => [
          p.key,
          p.name,
          p.connection ? `${p.connection.name} (${p.connection.kind})` : '-',
          p.inboundSets.join(',') || '-',
          p.outboundSets.join(',') || '-',
          p.flows.map((f) => `${f.direction} ${f.status}`).join(', ') || '-',
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
