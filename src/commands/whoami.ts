import {BaseCommand} from '../base-command.js'
import {IdentityUnavailableError} from '../lib/errors.js'

export default class Whoami extends BaseCommand<typeof Whoami> {
  static description = 'Show the authenticated identity (organization and key scope).'

  static examples = ['<%= config.bin %> whoami']

  async run(): Promise<void> {
    // getAuthedClient throws NotAuthenticatedError when neither env nor stored key
    // is present, so cred is guaranteed defined in the success and degraded paths.
    const cred = await this.resolveCredentials()
    const client = await this.getAuthedClient()
    try {
      const id = await client.whoami()
      this.log(`${id.organization} (scope: ${id.keyScope}, key ...${id.keyHint})`)
    } catch (err) {
      // No identity endpoint yet: report the locally-known key rather than failing.
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log(`A key is present (...${cred!.token.slice(-4)}), but identity details are not available yet.`)
      this.log('Run `tedi x12 seg ISA` to verify the key authenticates.')
    }
  }
}
