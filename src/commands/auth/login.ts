import {Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {TediError} from '../../lib/errors.js'

/** How long to keep polling the device-authorization endpoint, as a safety cap. */
const MAX_POLL_MS = 5 * 60 * 1000

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static description =
    'Authenticate with the Tediware platform. Uses a browser device flow; signup and EULA consent happen in the browser.'

  static examples = ['<%= config.bin %> auth login', '<%= config.bin %> auth login --key <api-key>']

  static flags = {
    key: Flags.string({
      description:
        'Stopgap: store a pre-issued API key directly, skipping the device flow. Sign up and accept the EULA on the web first.',
    }),
  }

  async run(): Promise<void> {
    if (this.flags.key) {
      await this.credentials.set({token: this.flags.key})
      this.log('Saved API key. Run `tedi whoami` to confirm.')
      return
    }

    const client = await this.getClient()
    const start = await client.startDeviceAuth()

    this.log('To sign in, open the following URL in your browser:')
    this.log('')
    this.log(`    ${start.verificationUri}`)
    this.log('')
    this.log(`and enter the code:  ${start.userCode}`)
    this.log('')
    this.log('Waiting for authorization...')

    const token = await this.poll(client, start.deviceCode, start.interval)
    await this.credentials.set({token})
    this.log('')
    this.log('Authorized. Run `tedi whoami` to confirm.')
  }

  private async poll(
    client: Awaited<ReturnType<BaseCommand<typeof AuthLogin>['getClient']>>,
    deviceCode: string,
    intervalSec: number,
  ): Promise<string> {
    const deadline = Date.now() + MAX_POLL_MS
    let intervalMs = Math.max(1, intervalSec) * 1000

    while (Date.now() < deadline) {
      const res = await client.pollDeviceAuth(deviceCode)
      switch (res.status) {
        case 'complete':
          return res.token
        case 'pending':
          break
        case 'slow_down':
          intervalMs += 1000
          break
        case 'expired':
          throw new TediError('The authorization code expired before sign-in completed.', {
            suggestions: ['Run `tedi auth login` again.'],
          })
        case 'denied':
          throw new TediError('Authorization was denied.')
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new TediError('Timed out waiting for authorization.', {suggestions: ['Run `tedi auth login` again.']})
  }
}
