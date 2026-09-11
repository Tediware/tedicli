import {Args} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {assertConfigKey, normalizeConfigValue} from '../../lib/config-store.js'

export default class ConfigSet extends BaseCommand<typeof ConfigSet> {
  static summary = 'Store a configuration value.'

  static description =
    'Local. Nothing is sent. api.baseUrl takes a scheme and host only (https://tediware.com, http://localhost:5004); a path, query or userinfo is refused, and a trailing slash is dropped.'

  static examples = [
    '<%= config.bin %> config set x12.release 005010',
    '<%= config.bin %> config set api.baseUrl http://localhost:5004',
  ]

  static args = {
    key: Args.string({description: 'Configuration key.', required: true}),
    value: Args.string({description: 'Value to store.', required: true}),
  }

  async run(): Promise<void> {
    const {key, value} = this.args
    assertConfigKey(key)
    const stored = normalizeConfigValue(key, value)
    await this.configStore.set(key, stored)
    this.log(`Set ${key} = ${stored}`)
  }
}
