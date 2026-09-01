import {BaseCommand} from '../../base-command.js'
import {API_KEY_ENV} from '../../lib/credentials.js'
import {IdentityUnavailableError} from '../../lib/errors.js'

export default class AuthStatus extends BaseCommand<typeof AuthStatus> {
  static description = 'Report whether you are signed in and, if so, the authenticated identity.'

  static examples = ['<%= config.bin %> auth status']

  async run(): Promise<void> {
    const cred = await this.resolveCredentials()
    if (!cred) {
      this.log('Not signed in. Run `tedi auth login` to authenticate.')
      return
    }

    const client = await this.getAuthedClient()
    const via = cred.source === 'env' ? ` (from ${API_KEY_ENV})` : ''
    try {
      const id = await client.whoami()
      this.log('Signed in.')
      this.log(`  Organization: ${id.organization}`)
      this.log(`  Key scope:    ${id.keyScope}`)
      this.log(`  Key:          ${id.keyLabel ?? '(unnamed)'} ...${id.keyHint}${via}`)
      this.log(`  Terms:        ${id.termsAccepted ? 'accepted' : 'NOT accepted — reference and inspection will be refused'}`)
    } catch (err) {
      // A server without the identity endpoint: still confirm a key is present,
      // using the locally-known token for the hint, rather than failing outright.
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log(`Signed in (key ...${cred.token.slice(-4)})${via}.`)
      this.log('This server does not report identity; run `tedi x12 seg ISA` to verify the key works.')
    }
  }
}
