import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {SourceDetail} from '../../lib/platform.js'

export default class SourceGet extends PlatformCommand<typeof SourceGet> {
  static summary = 'Show one source: its sample document, the semantics note, and the mappings reading it.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> source get 9c1b2a3d-...', '<%= config.bin %> source get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Source id (from `source list` or `mapping get`).', required: true}),
  }

  async run(): Promise<SourceDetail> {
    const client = await this.getAuthedClient()
    const s = await client.sourceGet(this.requireId(this.args.id, 'source id'))

    this.log(s.name)
    this.log(`Id             ${s.id}`)
    if (s.semantics) this.log(`Semantics      ${s.semantics}`)

    this.log('')
    this.log('Mappings reading it:')
    if (s.mappings.length === 0) this.log('  -')
    for (const m of s.mappings) this.log(`  ${m.id}  ${m.name}`)

    this.log('')
    this.log('Sample:')
    this.log('```')
    this.log(typeof s.sample === 'string' ? s.sample : JSON.stringify(s.sample, null, 2))
    this.log('```')

    return s
  }
}
