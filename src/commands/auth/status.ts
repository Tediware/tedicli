import {BaseCommand} from '../../base-command.js'

export default class AuthStatus extends BaseCommand<typeof AuthStatus> {
  static description = 'Report whether you are signed in and, if so, the authenticated identity.'

  static examples = ['<%= config.bin %> auth status']

  async run(): Promise<void> {
    const stored = await this.credentials.get()
    if (!stored) {
      this.log('Not signed in. Run `tedi auth login` to authenticate.')
      return
    }

    const client = await this.getAuthedClient()
    const id = await client.whoami()
    this.log('Signed in.')
    this.log(`  Organization: ${id.organization}`)
    this.log(`  Key scope:    ${id.keyScope}`)
    this.log(`  Key:          ...${id.keyHint}`)
  }
}
