import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {PlatformResult} from '../../lib/platform.js'
import {artifactTable, errorLines} from '../../lib/render.js'
import {cell, formatTime} from '../../lib/table.js'

export default class ResultGet extends PlatformCommand<typeof ResultGet> {
  static summary = 'Show one processing result, including its error and its stored artifacts.'

  static description = SERVER_DATA

  static examples = ['<%= config.bin %> result get 4d0e9f5a-...', '<%= config.bin %> result get 4d0e9f5a-... --json']

  static args = {
    id: Args.string({description: 'Result id (from `result list`, `tedi trace`, or a webhook delivery).', required: true}),
  }

  async run(): Promise<PlatformResult> {
    const client = await this.getAuthedClient()
    const result = await client.resultGet(this.requireId(this.args.id, 'result id'))

    this.log(`Node       ${cell(result.nodeName)}`)
    this.log(`Status     ${result.status ?? (result.detail.errorMessage ? 'error' : 'success')}`)
    this.log(`Partner    ${cell(result.detail.partner?.key)}`)
    this.log(`Direction  ${cell(result.detail.direction)} (the node's, not the document's)`)
    this.log(`Trace      ${cell(result.traceGuid)}`)
    this.log(`Created    ${formatTime(result.createdAt)}`)
    if (result.detail.transformations?.length) {
      this.log(`Steps      ${result.detail.transformations.join(' > ')}`)
    }
    if (result.detail.resend) this.log('Resend     yes')

    const [message, ...findings] = errorLines(result.detail)
    if (message) {
      this.log(`Error      ${message}`)
      for (const line of findings) this.log(`         ${line}`)
    }
    if (result.detail.mappingFailed) this.log('Mapping    failed (delivered flagged)')

    const artifacts = artifactTable(result.detail.artifacts ?? [])
    if (artifacts.length > 0) {
      this.log('')
      for (const line of artifacts) this.log(line)
    }

    return result
  }
}
