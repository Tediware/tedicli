import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {PartnerSendReceipt} from '../../lib/platform.js'
import {TediError} from '../../lib/errors.js'
import {readEdiInput} from '../../lib/edi-input.js'

export default class PartnerSend extends PlatformCommand<typeof PartnerSend> {
  static description =
    'Submit an own-shape JSON document for outbound EDI generation and delivery to a partner.'

  static examples = [
    '<%= config.bin %> partner send ACME 850 order.json',
    'cat order.json | <%= config.bin %> partner send ACME 850',
  ]

  static args = {
    key: Args.string({description: 'Partner key (as configured in Tediware).', required: true}),
    code: Args.string({description: 'Transaction set code to generate (e.g. 850).', required: true}),
    file: Args.string({description: 'JSON document to submit; stdin when omitted.'}),
  }

  static flags = {
    filename: Flags.string({description: 'Filename to record and deliver under (letters, numbers, ._-).'}),
  }

  async run(): Promise<PartnerSendReceipt> {
    // Direct stderr write: oclif silences logToStderr under --json, and a
    // silenced hint leaves an interactive `--json` run looking hung while
    // stdin waits for EOF. The wording is this command's own — the shared
    // helper's hint says "interchange", and this input is JSON.
    const raw = await readEdiInput(this.args.file ?? '-', () =>
      process.stderr.write('Reading JSON from the terminal — paste the document, then press Ctrl+D.\n'),
    )

    let contents: unknown
    try {
      contents = JSON.parse(raw)
    } catch {
      throw new TediError('The document is not valid JSON.', {
        suggestions: [
          'partner send takes your own JSON shape; the platform generates the EDI.',
          'To hand the platform raw EDI instead, use `tedi partner receive`.',
        ],
      })
    }

    const client = await this.getAuthedClient()
    const receipt = await client.partnerSend(this.args.key, this.args.code, contents, this.flags.filename)

    this.log('Processing queued.')
    this.log(`  Interchange ${receipt.interchangeControlNumber} / group ${receipt.groupControlNumber}`)
    this.log(`  Trace ${receipt.traceGuid}`)
    this.log('Follow it with `tedi feed list --trace <trace>` or `tedi result list --trace <trace>`.')
    return receipt
  }
}
