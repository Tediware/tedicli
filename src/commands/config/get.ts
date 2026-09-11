import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {assertConfigKey} from '../../lib/config-store.js'

export default class ConfigGet extends BaseCommand<typeof ConfigGet> {
  static enableJsonFlag = true

  static summary = 'Print one configuration value.'

  static description = 'Local. Nothing is sent. The value printed is the effective one: an environment override wins over the stored config, which wins over the default.'

  static examples = ['<%= config.bin %> config get x12.release', '<%= config.bin %> config get api.baseUrl --json']

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
  }

  async run(): Promise<{key: string; value: string}> {
    const {key} = this.args
    assertConfigKey(key)
    const value = await this.configStore.get(key)
    this.log(value)
    return {key, value}
  }
}
