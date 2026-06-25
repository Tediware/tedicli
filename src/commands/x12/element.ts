import {Args} from '@oclif/core'

import {X12Command} from '../../x12-base-command.js'

export default class X12Element extends X12Command<typeof X12Element> {
  static description = 'Look up an X12 element, including its valid code list (e.g. 235).'

  static examples = ['<%= config.bin %> x12 element 66', '<%= config.bin %> x12 element 235 --format markdown']

  static args = {
    id: Args.string({description: 'Element id, e.g. 66.', required: true}),
  }

  async run(): Promise<void> {
    const req = await this.referenceRequest()
    const client = await this.getAuthedClient()
    const doc = await client.x12Element(this.args.id, req)
    this.printReference(doc)
  }
}
