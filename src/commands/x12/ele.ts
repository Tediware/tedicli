import {Args} from '@oclif/core'

import {X12Command} from '../../x12-base-command.js'

export default class X12Ele extends X12Command<typeof X12Ele> {
  // `element` keeps working but stays out of the help listing; `ele` is canonical.
  static hiddenAliases = ['x12:element']

  static description = 'Look up an X12 element, including its valid code list (e.g. 235).'

  static examples = ['<%= config.bin %> x12 ele 66', '<%= config.bin %> x12 ele 235 --format markdown']

  static args = {
    id: Args.string({description: 'Element id, e.g. 66 (case-insensitive).', required: true}),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    // Accept whatever case the user types (element ids are numeric, but be consistent).
    const doc = await client.x12Element(this.args.id.toUpperCase(), req)
    this.printReference(doc)
  }
}
