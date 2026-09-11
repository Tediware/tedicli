import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {EnvelopeDetail} from '../../lib/platform.js'
import {cell} from '../../lib/table.js'

export default class EnvelopeGet extends PlatformCommand<typeof EnvelopeGet> {
  static summary = 'Show one envelope: every identifier and separator, and the partners using it with their role.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> envelope get 9c1b2a3d-...', '<%= config.bin %> envelope get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Envelope id (from `envelope list` or `partner get`).', required: true}),
  }

  async run(): Promise<EnvelopeDetail> {
    const client = await this.getAuthedClient()
    const e = await client.envelopeGet(this.requireId(this.args.id, 'envelope id'))

    this.log(`${e.name}  (${e.external ? "a partner's identity" : 'our identity'})`)
    this.log(`Id             ${e.id}`)
    this.log(`ISA            ${cell(e.interchangeExtidQualifier)} ${cell(e.interchangeExtid)}`)
    this.log(`GS             ${cell(e.applicationCode)}`)
    this.log(`Separators     segment ${cell(e.segmentSeparator)}  element ${cell(e.elementSeparator)}  component ${cell(e.componentSeparator)}`)

    this.log('')
    this.log('Partners:')
    if (e.partners.length === 0) this.log('  -')
    for (const p of e.partners) this.log(`  ${p.key.padEnd(12)} ${p.role.padEnd(9)} ${p.name}`)

    return e
  }
}
