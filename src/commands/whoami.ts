import {BaseCommand} from '../base-command.js'
import {Identity} from '../lib/api-client.js'
import {apiKeysUrl, IdentityUnavailableError} from '../lib/errors.js'

export default class Whoami extends BaseCommand<typeof Whoami> {
  static enableJsonFlag = true

  static summary = 'Show the identity behind your API key: organization, key scope, terms state.'

  static description =
    'Asks the Tediware server; spends no reference quota. Under --json the response is the server\'s identity shape unchanged.'

  static examples = ['<%= config.bin %> whoami', '<%= config.bin %> whoami --json']

  async run(): Promise<Identity | {identityAvailable: false; keyHint: string}> {
    // getAuthedClient throws NotAuthenticatedError when neither env nor stored key
    // is present, so cred is guaranteed defined in the success and degraded paths.
    const cred = await this.resolveCredentials()
    const client = await this.getAuthedClient()
    try {
      const id = await client.whoami()
      const label = id.keyLabel ? `'${id.keyLabel}'` : 'unnamed'
      this.log(`${id.organization.name} (scope: ${id.keyScope}, key ${label} ...${cred!.token.slice(-4)})`)
      // The JSON already carries serviceTermsAccepted; the warning is for a reader.
      if (!id.serviceTermsAccepted && !this.jsonEnabled()) {
        this.warn(
          `The current service terms have not been accepted; reference and inspection requests will be refused. Accept them at ${apiKeysUrl(client.baseUrl)}.`,
        )
      }

      return id
    } catch (err) {
      // A server without the identity endpoint: report the locally-known key
      // rather than failing.
      if (!(err instanceof IdentityUnavailableError)) throw err
      this.log(`A key is present (...${cred!.token.slice(-4)}), but this server does not report identity.`)
      this.log('Check `tedi config get api.baseUrl` points at a current Tediware server.')
      // A truthy value, so --json prints something a script can branch on
      // instead of empty stdout with exit 0.
      return {identityAvailable: false, keyHint: cred!.token.slice(-4)}
    }
  }
}
