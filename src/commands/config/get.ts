import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {assertConfigKey} from '../../lib/config-store.js'

export default class ConfigGet extends BaseCommand<typeof ConfigGet> {
  static description = 'Get a configuration value.'

  static examples = ['<%= config.bin %> config get x12.release']

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
  }

  async run(): Promise<void> {
    const {key} = this.args
    assertConfigKey(key)
    this.log(await this.configStore.get(key))
  }
}
