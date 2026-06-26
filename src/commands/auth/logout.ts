import {BaseCommand} from '../../base-command.js'
import {API_KEY_ENV} from '../../lib/credentials.js'

export default class AuthLogout extends BaseCommand<typeof AuthLogout> {
  static description = 'Clear stored Tediware credentials.'

  static examples = ['<%= config.bin %> auth logout']

  async run(): Promise<void> {
    const existing = await this.credentials.get()
    await this.credentials.clear()
    this.log(existing ? 'Signed out.' : 'No stored credentials to clear.')

    // Clearing the file can't unset an env override; the CLI would still be authed.
    if (process.env[API_KEY_ENV]?.trim()) {
      this.log(`Note: ${API_KEY_ENV} is still set in your environment; unset it to fully sign out.`)
    }
  }
}
