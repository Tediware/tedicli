import {BaseCommand} from '../../base-command.js'

export default class ConfigList extends BaseCommand<typeof ConfigList> {
  static description = 'List all configuration values and their sources.'

  static examples = ['<%= config.bin %> config list']

  async run(): Promise<void> {
    const entries = await this.configStore.list()
    for (const {key, value, source} of entries) {
      this.log(`${key} = ${value}  (${source})`)
    }
  }
}
