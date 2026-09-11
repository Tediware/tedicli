import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {EnvelopePage} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class EnvelopeList extends PlatformCommand<typeof EnvelopeList> {
  static summary = 'List your envelopes: whose identity each carries, and the ISA and GS identifiers.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> envelope list', '<%= config.bin %> envelope list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<EnvelopePage> {
    const client = await this.getAuthedClient()
    const page = await client.envelopeList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.envelopes.length === 0) {
      this.log('No envelopes in your organization.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'SIDE', 'ISA ID', 'QUAL', 'GS ID'],
        ...page.envelopes.map((e) => [
          e.id,
          e.name,
          e.external ? 'partner' : 'ours',
          cell(e.interchangeExtid),
          cell(e.interchangeExtidQualifier),
          cell(e.applicationCode),
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
