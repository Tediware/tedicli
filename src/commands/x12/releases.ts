import {Flags} from '@oclif/core'

import {ReleasesResponse} from '../../lib/api-client.js'
import {X12Command} from '../../x12-base-command.js'

export default class X12Releases extends X12Command<typeof X12Releases> {
  static enableJsonFlag = true

  static summary = 'List the X12 releases the platform carries.'

  static description = `Asks the Tediware server; no API key is needed, though one is sent when present so the call counts against your own allowance.

The release in effect (-r, then TEDI_X12_RELEASE, then config x12.release) is marked, and a warning is printed when it is not one the server carries. Under --json the response is the server's release list unchanged; this is version metadata, not licensed content.`

  static examples = [
    '<%= config.bin %> x12 releases',
    '<%= config.bin %> x12 releases --format markdown',
    '<%= config.bin %> x12 releases --json',
  ]

  static flags = {
    json: Flags.boolean({description: 'Print the server response as JSON.'}),
  }

  async run(): Promise<ReleasesResponse> {
    const client = await this.getClient()
    const response = await client.x12Releases()
    const releases = response.data.releases
    const def = await this.resolveRelease()
    const known = releases.some((r) => r.code === def)

    if (this.flags.format === 'markdown') {
      this.log('# X12 releases')
      this.log('')
      for (const r of releases) {
        this.log(`- **${r.code}** ${r.name ?? `Release ${r.code}`}${r.hipaa ? ' (HIPAA)' : ''}${r.code === def ? ' (default)' : ''}`)
      }
    } else {
      this.log('X12 releases on this server:')
      this.log('')
      for (const r of releases) {
        const marker = r.code === def ? '*' : ' '
        const label = r.name ?? `Release ${r.code}`
        const hipaa = r.hipaa ? '  (HIPAA)' : ''
        this.log(`  ${marker} ${r.code}  ${label}${hipaa}`)
      }
      this.log('')
      this.log(`  * default release (${def}). Change it with \`tedi config set x12.release <code>\` or -r.`)
    }

    if (!known) {
      this.warn(`The default release ${def} is not one this server carries. Lookups without -r will fail; run \`tedi config set x12.release <code>\` with a release listed above.`)
    }
    return response
  }
}
