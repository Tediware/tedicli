import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {WebhookDetail} from '../../lib/platform.js'
import {cell} from '../../lib/table.js'

export default class WebhookGet extends PlatformCommand<typeof WebhookGet> {
  static summary = 'Show one webhook: URL, kind, content type, whether deliveries are signed, and the partners delivering to it with their role.'

  static description = `${SERVER_DATA}

SIGNED is the server's signingSecretSet: yes means every delivery carries a verifiable X-Webhook-Signature. The signing secret itself is never returned. The outbound and error deliveries send the same body, so a partner that uses one webhook for both roles cannot tell delivered from failed without reading the result; give those roles separate webhooks.`

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
    if (w.signingSecretSet !== undefined) this.log(`Signed         ${w.signingSecretSet ? 'yes' : 'no'}`)

    this.log('')
    this.log('Partners:')
    if (w.partners.length === 0) this.log('  -')
    for (const p of w.partners) this.log(`  ${p.key.padEnd(12)} ${p.role.padEnd(9)} ${p.name}`)

    return w
  }
}
