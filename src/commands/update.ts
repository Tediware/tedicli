import {Args} from '@oclif/core'

import {BaseCommand} from '../base-command.js'
import {assertUpdatable, PACKAGE_NAME, selfUpdate} from '../lib/self-update.js'

export default class Update extends BaseCommand<typeof Update> {
  static summary = 'Update tedi to the latest version, or to a named one, through npm.'

  static description = `Runs \`npm install -g ${PACKAGE_NAME}\`, then prints the new version's release notes.

Refuses when the copy of tedi running is not the one npm would replace: a checkout on PATH, a wrapper, or a different Node's global prefix.

The CLI also checks npm for a newer version once a day and prints a one-line notice on a terminal; set TEDI_SKIP_NEW_VERSION_CHECK=1 to turn that off.`

  static examples = ['<%= config.bin %> update', '<%= config.bin %> update 0.4.1']

  static args = {
    version: Args.string({description: 'A specific version (or npm dist-tag) to install instead of the latest.'}),
  }

  async run(): Promise<void> {
    await assertUpdatable()

    const target = this.args.version ?? 'latest'
    this.log(`Updating ${PACKAGE_NAME} to ${target} via npm...`)
    this.log('')

    await selfUpdate(this.args.version)

    this.log('')
    this.log(`Updated. Run \`${this.config.bin} --version\` to confirm.`)
    // The postrun changelog hook prints the new version's release notes next.
  }
}
