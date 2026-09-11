import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ConnectionDetail} from '../../lib/platform.js'
import {cell} from '../../lib/table.js'

export default class ConnectionGet extends PlatformCommand<typeof ConnectionGet> {
  static summary = 'Show one connection: transport settings, AS2 identifiers, and the partners on it.'

  static description = `${SERVER_DATA}

Credentials are never returned; the server leaves them out rather than masking them.`

  static examples = ['<%= config.bin %> connection get 9c1b2a3d-...', '<%= config.bin %> connection get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Connection id (from `connection list` or `partner get`).', required: true}),
  }

  async run(): Promise<ConnectionDetail> {
    const client = await this.getAuthedClient()
    const c = await client.connectionGet(this.requireId(this.args.id, 'connection id'))

    this.log(`${c.name}  (${c.kind})`)
    this.log(`Id             ${c.id}`)
    if (c.host) this.log(`Host           ${c.host}${c.port ? `:${c.port}` : ''}${c.username ? ` as ${c.username}` : ''}`)
    if (c.inboundDirectory || c.outboundDirectory) {
      this.log(`Directories    in ${cell(c.inboundDirectory)}, out ${cell(c.outboundDirectory)}`)
    }
    if (c.as2Identifier || c.partnerAs2Identifier) {
      this.log(`AS2            us ${cell(c.as2Identifier)}, partner ${cell(c.partnerAs2Identifier)}${c.partnerUrl ? ` at ${c.partnerUrl}` : ''}`)
      if (c.as2SetupStatus) this.log(`AS2 setup      ${String(c.as2SetupStatus)}${c.as2SetupError ? ` (${String(c.as2SetupError)})` : ''}`)
    }
    this.log(`Provisioned    ${c.provisioned ? 'yes' : 'no'}${c.as2Ready !== undefined ? `, AS2 ready ${c.as2Ready ? 'yes' : 'no'}` : ''}`)

    this.log('')
    this.log('Partners:')
    if (c.partners.length === 0) this.log('  -')
    for (const p of c.partners) this.log(`  ${p.key.padEnd(12)} ${p.name}`)

    return c
  }
}
