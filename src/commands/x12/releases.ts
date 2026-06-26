import {BaseCommand} from '../../base-command.js'

export default class X12Releases extends BaseCommand<typeof X12Releases> {
  static description = 'List the supported X12 releases.'

  static examples = ['<%= config.bin %> x12 releases']

  async run(): Promise<void> {
    const client = await this.getAuthedClient()
    const releases = await client.x12Releases()
    const def = await this.configStore.get('x12.release')

    this.log('Supported X12 releases:')
    this.log('')
    for (const r of releases) {
      const marker = r.code === def ? '*' : ' '
      const label = r.name ?? `Release ${r.code}`
      const hipaa = r.hipaa ? '  (HIPAA)' : ''
      this.log(`  ${marker} ${r.code}  ${label}${hipaa}`)
    }
    this.log('')
    this.log(`  * current default (${def}). Change with \`tedi config set x12.release <code>\`.`)
  }
}
