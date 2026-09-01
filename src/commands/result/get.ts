import {Args} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {PlatformResult} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class ResultGet extends PlatformCommand<typeof ResultGet> {
  static description = 'Show one processing result, including its stored artifacts.'

  static examples = ['<%= config.bin %> result get 4d0e9f5a-...', '<%= config.bin %> result get 4d0e9f5a-... --json']

  static args = {
    id: Args.string({description: 'Result id (from `result list` or a webhook delivery).', required: true}),
  }

  async run(): Promise<PlatformResult> {
    const client = await this.getAuthedClient()
    const result = await client.resultGet(this.args.id)

    this.log(`Node       ${cell(result.nodeName)}`)
    this.log(`Direction  ${cell(result.detail.direction)}`)
    this.log(`Trace      ${cell(result.traceGuid)}`)
    this.log(`Created    ${result.createdAt}`)
    if (result.detail.transformations?.length) {
      this.log(`Steps      ${result.detail.transformations.join(' > ')}`)
    }

    if (result.detail.errorMessage) this.log(`Error      ${result.detail.errorMessage}`)
    if (result.detail.mappingFailed) this.log('Mapping    failed (delivered flagged)')

    const artifacts = result.detail.artifacts ?? []
    if (artifacts.length > 0) {
      this.log('')
      this.log('Artifacts (fetch with `tedi artifact get <id>`):')
      this.log(
        renderTable([
          ['ID', 'USAGE', 'TYPE', 'FILENAME'],
          ...artifacts.map((a) => [a.id, a.usage, cell(a.contentType), cell(a.filename)]),
        ]),
      )
    }

    return result
  }
}
