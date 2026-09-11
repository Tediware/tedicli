import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {assertConfigKey, CONFIG_KEYS} from '../../lib/config-store.js'

export default class ConfigUnset extends BaseCommand<typeof ConfigUnset> {
  static summary = 'Remove a stored configuration value, so the default (or the environment) applies again.'

  static description = 'Local. Nothing is sent.'

  static examples = ['<%= config.bin %> config unset api.baseUrl']

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
  }

  async run(): Promise<void> {
    const {key} = this.args
    assertConfigKey(key)
    const had = await this.configStore.unset(key)
    const now = await this.configStore.get(key)
    this.log(had ? `Unset ${key}. Now ${now}${now === CONFIG_KEYS[key].default ? ' (default)' : ' (from the environment)'}.` : `${key} was not set.`)
  }
}
