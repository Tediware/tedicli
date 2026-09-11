import {BaseCommand} from '../../base-command.js'
import {API_KEY_ENV} from '../../lib/credentials.js'
import {EXIT_UNUSABLE, IdentityUnavailableError, TediError} from '../../lib/errors.js'

interface CredentialStatus {
  signedIn: true
  source: 'stored' | 'env'
  keyLabel: string | null
  keyHint: string
  configDir: string
}

export default class AuthStatus extends BaseCommand<typeof AuthStatus> {
  static enableJsonFlag = true

  static summary = 'Report the credential in use: signed in or not, where the key came from, its label.'

  static description = `Talks to the Tediware server to read the key's label. For the identity behind the key (organization, scope, terms), run \`tedi whoami\`.

Exits 2 when not signed in, so a script can gate on it.`

  static examples = ['<%= config.bin %> auth status', '<%= config.bin %> auth status --json']

  async run(): Promise<CredentialStatus> {
    const cred = await this.resolveCredentials()
    if (!cred) {
      throw new TediError('Not signed in.', {
        suggestions: ['Run `tedi auth login`, or set TEDI_API_KEY in your environment.'],
        exitCode: EXIT_UNUSABLE,
      })
    }

    const client = await this.getAuthedClient()
    let keyLabel: string | null = null
    try {
      keyLabel = (await client.whoami()).keyLabel
    } catch (err) {
      // A server without the identity endpoint: the credential is still known
      // locally, so report it without a label rather than failing.
      if (!(err instanceof IdentityUnavailableError)) throw err
    }

    const status: CredentialStatus = {
      signedIn: true,
      source: cred.source,
      keyLabel,
      keyHint: cred.token.slice(-4),
      configDir: this.configDir,
    }

    this.log('Signed in.')
    this.log(`  Key:        ${keyLabel ?? '(unnamed)'} ...${status.keyHint}`)
    this.log(`  Source:     ${cred.source === 'env' ? API_KEY_ENV : 'stored'}`)
    this.log(`  Config dir: ${status.configDir}`)
    this.log('Run `tedi whoami` for the organization, scope and terms behind the key.')
    return status
  }
}
