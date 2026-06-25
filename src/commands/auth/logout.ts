import {BaseCommand} from '../../base-command.js'

export default class AuthLogout extends BaseCommand<typeof AuthLogout> {
  static description = 'Clear stored Tediware credentials.'

  static examples = ['<%= config.bin %> auth logout']

  async run(): Promise<void> {
    const existing = await this.credentials.get()
    await this.credentials.clear()
    this.log(existing ? 'Signed out.' : 'No stored credentials to clear.')
  }
}
