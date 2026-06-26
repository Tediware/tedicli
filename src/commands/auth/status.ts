import {BaseCommand} from '../../base-command.js'
import {IdentityUnavailableError} from '../../lib/errors.js'

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
    try {
      const id = await client.whoami()
      this.log('Signed in.')
      this.log(`  Organization: ${id.organization}`)
      this.log(`  Key scope:    ${id.keyScope}`)
      this.log(`  Key:          ...${id.keyHint}`)
    } catch (err) {
      // The identity endpoint isn't available yet: still confirm a key is stored,
      // using the locally-held token for the hint, rather than failing outright.
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log(`Signed in (key ...${stored.token.slice(-4)}).`)
      this.log('Identity details are not available yet; run `tedi x12 releases` to verify the key works.')
    }
  }
}
