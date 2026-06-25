import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {CONFIG_KEYS, isConfigKey} from '../../lib/config-store.js'
import {TediError} from '../../lib/errors.js'

export default class ConfigGet extends BaseCommand<typeof ConfigGet> {
  static description = 'Get a configuration value.'

  static examples = ['<%= config.bin %> config get x12.release']

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
  }

  async run(): Promise<void> {
    const {key} = this.args
    if (!isConfigKey(key)) {
      throw new TediError(`Unknown configuration key: ${key}`, {
        suggestions: [`Valid keys: ${Object.keys(CONFIG_KEYS).join(', ')}`],
      })
    }
    this.log(await this.configStore.get(key))
  }
}
