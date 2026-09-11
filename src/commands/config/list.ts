import {BaseCommand} from '../../base-command.js'
import {ConfigEntry} from '../../lib/config-store.js'

export default class ConfigList extends BaseCommand<typeof ConfigList> {
  static enableJsonFlag = true

  static summary = 'List every configuration value, where it comes from, and the config directory in use.'

  static description = 'Local. Nothing is sent. A value that would be refused at the point of use (an unusable TEDI_API_BASE_URL, say) is flagged here.'

  static examples = ['<%= config.bin %> config list', '<%= config.bin %> config list --json']

  async run(): Promise<{configDir: string; entries: ConfigEntry[]}> {
    const entries = await this.configStore.list()
    this.log(`Config dir: ${this.configDir}`)
    for (const {key, value, source, problem} of entries) {
      this.log(`${key} = ${value}  (${source})${problem ? `  INVALID: ${problem}` : ''}`)
    }
    return {configDir: this.configDir, entries}
  }
}
