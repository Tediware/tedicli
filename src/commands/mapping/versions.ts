import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {MappingVersionPage} from '../../lib/platform.js'
import {cell, formatTime, renderTable} from '../../lib/table.js'

export default class MappingVersions extends PlatformCommand<typeof MappingVersions> {
  static summary = "List one mapping's versions, oldest first: number, note, author and date."

  static description = `${SERVER_DATA}

A version's transformation is read with \`mapping get <id> --version <n>\`.`

  static examples = ['<%= config.bin %> mapping versions 9c1b2a3d-...', '<%= config.bin %> mapping versions 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Mapping id (from `mapping list`).', required: true}),
  }

  static flags = {
    ...PlatformCommand.paginationFlags,
  }

  async run(): Promise<MappingVersionPage> {
    const client = await this.getAuthedClient()
    const id = this.requireId(this.args.id, 'mapping id')
    const page = await client.mappingVersions(id, {limit: this.flags.limit, cursor: this.flags.cursor})

    if (page.versions.length === 0) {
      this.log('No versions yet.')
      return page
    }

    this.log(
      renderTable([
        ['VERSION', 'SAVED', 'BY', 'NOTE'],
        ...page.versions.map((v) => [String(v.versionNumber), formatTime(v.createdAt), v.createdBy?.name ?? '-', cell(v.note)]),
      ]),
    )
    this.logPageHint(page.pagination)
    return page
  }
}
