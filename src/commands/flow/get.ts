import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {FlowDetail} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class FlowGet extends PlatformCommand<typeof FlowGet> {
  static summary = 'Show one flow: its partner, status and schedule, and the graph as nodes and edges.'

  static description = `${SERVER_DATA}

Node configuration is not included. A node's connection, webhook, mapping or implementation is read through that resource's own command.`

  static examples = ['<%= config.bin %> flow get 9c1b2a3d-...', '<%= config.bin %> flow get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Flow id (from `flow list` or `partner get`).', required: true}),
  }

  async run(): Promise<FlowDetail> {
    const client = await this.getAuthedClient()
    const f = await client.flowGet(this.requireId(this.args.id, 'flow id'))

    this.log(`${f.name}  (${f.partner.key}, ${f.direction})`)
    this.log(`Id             ${f.id}`)
    this.log(`Status         ${f.status}`)
    this.log(`Frequency      ${f.frequency === 0 ? 'paused' : `every ${f.frequency} minutes`}`)
    this.log(`Version        ${f.versionNumber}`)
    this.log(`Sandbox        ${f.usesSandbox ? 'yes' : 'no'}`)

    const nameOf = new Map(f.nodes.map((n) => [n.id, n.name]))
    this.log('')
    this.log('Nodes:')
    if (f.nodes.length === 0) this.log('  -')
    else this.log(renderTable([['ID', 'NAME', 'KIND', 'SERVICE'], ...f.nodes.map((n) => [n.id, n.name, n.kind, n.service])]))

    this.log('')
    this.log('Edges:')
    if (f.connections.length === 0) this.log('  -')
    for (const edge of f.connections) {
      this.log(`  ${nameOf.get(edge.from) ?? edge.from} -> ${nameOf.get(edge.to) ?? edge.to}`)
    }

    return f
  }
}
