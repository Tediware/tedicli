import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {ImplementationDetail} from '../../lib/platform.js'
import {cell} from '../../lib/table.js'

export default class ImplementationGet extends PlatformCommand<typeof ImplementationGet> {
  static summary = 'Show one implementation: transaction set, status, description, and the mappings and partners using it.'

  static description = `${SERVER_DATA}

The structure itself is not shown here. \`implementation schema\` gives the JSON shape a mapping targets, \`implementation guide\` the readable guide, and \`implementation export\` the portable file.`

  static examples = ['<%= config.bin %> implementation get 9c1b2a3d-...', '<%= config.bin %> implementation get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Implementation id (from `implementation list` or `partner get`).', required: true}),
  }

  async run(): Promise<ImplementationDetail> {
    const client = await this.getAuthedClient()
    const i = await client.implementationGet(this.requireId(this.args.id, 'implementation id'))

    this.log(`${i.name}  (${i.transactionSet.identifier} in ${i.transactionSet.release})`)
    this.log(`Id             ${i.id}`)
    this.log(`Version        ${cell(i.version)}`)
    this.log(`Status         ${cell(i.status)}`)
    if (i.description) this.log(`Description    ${i.description}`)
    if (i.tags.length > 0) this.log(`Tags           ${i.tags.join(', ')}`)
    this.log(`Structure      ${i.segmentUseCount} segments, ${i.loopUseCount} loops`)
    this.log(`Copied from    ${i.sourceImplementation ? `${i.sourceImplementation.name} (${i.sourceImplementation.id})` : '-'}`)

    this.log('')
    this.log('Mappings targeting it:')
    if (i.mappings.length === 0) this.log('  -')
    for (const m of i.mappings) this.log(`  ${m.id}  ${m.name}`)

    this.log('')
    this.log('Partners using it directly:')
    if (i.partners.length === 0) this.log('  -')
    for (const p of i.partners) this.log(`  ${p.key.padEnd(12)} ${p.name}`)

    return i
  }
}
