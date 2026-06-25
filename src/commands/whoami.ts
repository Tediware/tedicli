import {BaseCommand} from '../base-command.js'

export default class Whoami extends BaseCommand<typeof Whoami> {
  static description = 'Show the authenticated identity (organization and key scope).'

  static examples = ['<%= config.bin %> whoami']

  async run(): Promise<void> {
    const client = await this.getAuthedClient()
    const id = await client.whoami()
    this.log(`${id.organization} (scope: ${id.keyScope}, key ...${id.keyHint})`)
  }
}
