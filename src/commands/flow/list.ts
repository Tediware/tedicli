import {Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {FlowPage} from '../../lib/platform.js'
import {renderTable} from '../../lib/table.js'

export default class FlowList extends PlatformCommand<typeof FlowList> {
  static summary = 'List your flows: partner, direction, status, schedule and version.'

  static description = `${SERVER_DATA}

Only the current version of each flow is listed. FREQUENCY is the polling interval in minutes; 0 means paused. Only an active flow accepts traffic.`

  static examples = [
    '<%= config.bin %> flow list',
    '<%= config.bin %> flow list --partner ACME --direction outbound',
    '<%= config.bin %> flow list --status pending --json',
  ]

  static flags = {
    partner: Flags.string({description: 'Only this partner (key, case-insensitive).'}),
    direction: PlatformCommand.directionFlag(),
    status: Flags.option({options: ['pending', 'active'] as const, description: 'Only flows in this status.'})(),
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<FlowPage> {
    const client = await this.getAuthedClient()
    const page = await client.flowList({
      partner: this.flags.partner,
      direction: this.flags.direction,
      status: this.flags.status,
      limit: this.flags.limit,
      cursor: this.flags.cursor,
    })

    if (page.flows.length === 0) {
      this.log('No flows match.')
      return page
    }

    this.log(
      renderTable([
        ['ID', 'NAME', 'PARTNER', 'DIRECTION', 'STATUS', 'FREQUENCY', 'VERSION', 'SANDBOX'],
        ...page.flows.map((f) => [
          f.id,
          f.name,
          f.partner.key,
          f.direction,
          f.status,
          f.frequency === 0 ? 'paused' : `${f.frequency}m`,
          String(f.versionNumber),
          f.usesSandbox ? 'yes' : 'no',
        ]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
