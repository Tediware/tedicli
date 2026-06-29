import {BaseCommand} from '../../base-command.js'
import {API_KEY_ENV} from '../../lib/credentials.js'
import {TediError} from '../../lib/errors.js'
import {promptSecret, readStdin} from '../../lib/prompt.js'

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static description =
    'Authenticate by storing a Tediware API key. Create the key in the dashboard (sign up and accept the service terms there first), then paste it when prompted.'

  static examples = ['<%= config.bin %> auth login', 'cat key.txt | <%= config.bin %> auth login']

  async run(): Promise<void> {
    const key = await this.readKey()
    if (!key) {
      throw new TediError('No API key provided.', {
        suggestions: [
          'Run `tedi auth login` in an interactive terminal and paste the key when prompted,',
          'pipe it in (`cat key.txt | tedi auth login`),',
          `or set ${API_KEY_ENV} in your environment for one-off or CI use.`,
        ],
      })
    }

    await this.credentials.set({token: key})
    this.log('Saved API key. Run `tedi x12 releases` to confirm it works.')
  }

  /**
   * Read the key without ever placing it in argv (where it would leak into shell
   * history and process listings): the `TEDI_API_KEY` env value, piped stdin, or
   * a no-echo interactive prompt — in that order. Env is checked before stdin so
   * a non-interactive run with the env set doesn't block waiting on stdin.
   */
  private async readKey(): Promise<string> {
    const fromEnv = process.env[API_KEY_ENV]?.trim()
    if (fromEnv) {
      this.log(`Using ${API_KEY_ENV} from the environment.`)
      return fromEnv
    }
    if (!process.stdin.isTTY) return (await readStdin()).trim()
    // The input is hidden (no echo), so say so — otherwise the blank prompt looks
    // like a hang while the user wonders whether their paste registered.
    this.log('Paste your Tediware API key, then press Enter. The key stays hidden as you type.')
    return promptSecret('API key: ')
  }
}
