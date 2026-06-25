import {Flags} from '@oclif/core'

import {BaseCommand} from '../base-command.js'
import {PACKAGE_NAME, selfUpdate} from '../lib/self-update.js'

export default class Update extends BaseCommand<typeof Update> {
  static description = 'Update tedi to the latest version (installs via npm).'

  static examples = ['<%= config.bin %> update', '<%= config.bin %> update --version 1.2.3']

  static flags = {
    version: Flags.string({
      description: 'Install a specific version instead of the latest.',
    }),
  }

  async run(): Promise<void> {
    const target = this.flags.version ?? 'latest'
    this.log(`Updating ${PACKAGE_NAME} to ${target} via npm...`)
    this.log('')

    await selfUpdate(this.flags.version)

    this.log('')
    this.log(`Updated. Run \`${this.config.bin} --version\` to confirm.`)
    // The postrun changelog hook prints the new version's release notes next.
  }
}
