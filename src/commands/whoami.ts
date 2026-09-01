import {BaseCommand} from '../base-command.js'
import {Identity} from '../lib/api-client.js'
import {IdentityUnavailableError} from '../lib/errors.js'

export default class Whoami extends BaseCommand<typeof Whoami> {
  static enableJsonFlag = true

  static description = 'Show the authenticated identity (organization, key scope, terms state).'

  static examples = ['<%= config.bin %> whoami']

  async run(): Promise<Identity | {identityAvailable: false; keyHint: string}> {
    // getAuthedClient throws NotAuthenticatedError when neither env nor stored key
    // is present, so cred is guaranteed defined in the success and degraded paths.
    const cred = await this.resolveCredentials()
    const client = await this.getAuthedClient()
    try {
      const id = await client.whoami()
      const label = id.keyLabel ? `'${id.keyLabel}'` : 'unnamed'
      this.log(`${id.organization} (scope: ${id.keyScope}, key ${label} ...${id.keyHint})`)
      if (!id.termsAccepted) {
        this.warn('The current service terms have not been accepted; reference and inspection requests will be refused.')
      }

      return id
    } catch (err) {
      // A server without the identity endpoint: report the locally-known key
      // rather than failing.
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log(`A key is present (...${cred!.token.slice(-4)}), but this server does not report identity.`)
      this.log('Run `tedi x12 seg ISA` to verify the key authenticates.')
      // A truthy value, so --json prints something a script can branch on
      // instead of empty stdout with exit 0.
      return {identityAvailable: false, keyHint: cred!.token.slice(-4)}
    }
  }
}
