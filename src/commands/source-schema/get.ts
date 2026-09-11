import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {SourceSchemaDetail} from '../../lib/platform.js'

export default class SourceSchemaGet extends PlatformCommand<typeof SourceSchemaGet> {
  static summary = 'Show one source schema: its sample document, the semantics note, and the mappings reading it.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> source-schema get 9c1b2a3d-...', '<%= config.bin %> source-schema get 9c1b2a3d-... --json']

  static args = {
    id: Args.string({description: 'Source schema id (from `source-schema list` or `mapping get`).', required: true}),
  }

  async run(): Promise<SourceSchemaDetail> {
    const client = await this.getAuthedClient()
    const s = await client.sourceSchemaGet(this.requireId(this.args.id, 'source schema id'))

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
