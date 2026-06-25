import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {assertConfigKey} from '../../lib/config-store.js'

export default class ConfigSet extends BaseCommand<typeof ConfigSet> {
  static description = 'Set a configuration value.'

  static examples = ['<%= config.bin %> config set x12.release 005010']

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
    value: Args.string({description: 'Value to store.', required: true}),
  }

  async run(): Promise<void> {
    const {key, value} = this.args
    assertConfigKey(key)
    await this.configStore.set(key, value)
    this.log(`Set ${key} = ${value}`)
  }
}
