import {Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {API_KEY_ENV} from '../../lib/credentials.js'
import {apiKeysUrl, IdentityUnavailableError, TediError} from '../../lib/errors.js'
import {promptSecret, readStdin} from '../../lib/prompt.js'

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static summary = 'Store a Tediware API key, then confirm it authenticates.'

  static description = `Talks to the Tediware server once, to confirm the key (pass --no-verify to skip).

Create the key in the dashboard (sign up and accept the service terms there first), then paste it when prompted, pipe it in, or set ${API_KEY_ENV}. The key is read from stdin first, then the environment, and never from a flag, so it cannot land in shell history or a process listing.`

  static examples = [
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth login < key.txt',
    '<%= config.bin %> auth login --profile staging',
  ]

  static flags = {
    verify: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Call `whoami` after storing the key and print the identity. --no-verify stores it without asking the server.',
    }),
  }

  async run(): Promise<void> {
    const key = await this.readKey()
    if (!key) {
      throw new TediError('No API key provided.', {
        suggestions: [
          'Run `tedi auth login` in an interactive terminal and paste the key when prompted,',
          'pipe it in (`tedi auth login < key.txt`),',
          `or set ${API_KEY_ENV} in your environment for one-off or CI use.`,
        ],
      })
    }

    await this.credentials.set({token: key})
    this.log(`Saved API key to ${this.configDir}.`)

    if (!this.flags.verify) {
      this.log('Run `tedi whoami` to confirm it authenticates.')
      return
    }

    const client = await this.getAuthedClient()
    try {
      const id = await client.whoami()
      this.log(`Signed in to ${id.organization.name} (scope: ${id.keyScope}, key ${id.keyLabel ? `'${id.keyLabel}'` : 'unnamed'}).`)
      if (!id.serviceTermsAccepted) {
        this.warn(
          `The current service terms have not been accepted, so reference and inspection requests will be refused. Accept them at ${apiKeysUrl(client.baseUrl)}.`,
        )
      }
    } catch (err) {
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log('This server does not report identity, so the key was stored unverified. Run `tedi whoami` once it does.')
    }
  }

  /**
   * Read the key without ever placing it in argv: piped stdin, then the
   * `TEDI_API_KEY` env value, then a no-echo interactive prompt. Stdin wins
   * over the environment because a pipe is the more deliberate act; an env
   * key that is meant to stay in force needs no login at all.
   *
   * The first non-empty line is the key. A file with a trailing newline, a
   * copied line with a blank above it, or a heredoc all reduce to that; a key
   * spanning lines is not a thing, so the rest is ignored rather than stored.
   */
  private async readKey(): Promise<string> {
    if (!process.stdin.isTTY) {
      const line = (await readStdin()).split(/\r?\n/).find((l) => l.trim() !== '')?.trim()
      if (line !== undefined) return this.checked(line)
    }
    const fromEnv = process.env[API_KEY_ENV]?.trim()
    if (fromEnv) {
      this.log(`Using ${API_KEY_ENV} from the environment.`)
      return this.checked(fromEnv)
    }
    if (!process.stdin.isTTY) return ''
    // The input is hidden (no echo), so say so; otherwise the blank prompt looks
    // like a hang while the user wonders whether their paste registered.
    this.log('Paste your Tediware API key, then press Enter. The key stays hidden as you type.')
    return this.checked((await promptSecret('API key: ')).trim())
  }

  /** A key is one line of printable characters; anything else is not a key. */
  private checked(key: string): string {
    if (/[\x00-\x1f\x7f]/.test(key)) {
      throw new TediError('The API key contains control characters, so it was not stored.', {
        suggestions: ['Copy the key again from the dashboard; a key is one line of printable characters.'],
      })
    }
    return key
  }
}
