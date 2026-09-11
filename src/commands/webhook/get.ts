import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {WebhookDetail} from '../../lib/platform.js'
import {cell} from '../../lib/table.js'

export default class WebhookGet extends PlatformCommand<typeof WebhookGet> {
  static summary = 'Show one webhook: URL, kind, content type, and the partners delivering to it with their role.'

  static description = `${SERVER_DATA}

The signing secret is never returned.`

  static examples = ['<%= config.bin %> webhook get 9c1b2a3d-...', '<%= config.bin %> webhook get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Webhook id (from `webhook list` or `partner get`).', required: true}),
  }

  async run(): Promise<WebhookDetail> {
    const client = await this.getAuthedClient()
    const w = await client.webhookGet(this.requireId(this.args.id, 'webhook id'))

    this.log(`${w.name}  (${w.kind})`)
    this.log(`Id             ${w.id}`)
    this.log(`URL            ${w.url}`)
    this.log(`Content type   ${cell(w.contentType)}`)

    this.log('')
    this.log('Partners:')
    if (w.partners.length === 0) this.log('  -')
    for (const p of w.partners) this.log(`  ${p.key.padEnd(12)} ${p.role.padEnd(9)} ${p.name}`)

    return w
  }
}
