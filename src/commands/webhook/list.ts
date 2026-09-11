import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {WebhookPage} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class WebhookList extends PlatformCommand<typeof WebhookList> {
  static summary = 'List your webhooks: name, kind and URL.'

  static description = `${SERVER_DATA}

Signing secrets are never returned.`

  static examples = ['<%= config.bin %> webhook list', '<%= config.bin %> webhook list --json']

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<WebhookPage> {
    const client = await this.getAuthedClient()
    const page = await client.webhookList({limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.webhooks.length === 0) {
      this.log('No webhooks in your organization.')
      return page
    }

    this.log(renderTable([['ID', 'NAME', 'KIND', 'URL'], ...page.webhooks.map((w) => [w.id, w.name, w.kind, w.url])]))
    this.logPageHint(page.pagination)
    return page
  }
}
