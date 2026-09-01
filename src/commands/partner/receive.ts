import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {PartnerReceiveReceipt} from '../../lib/platform.js'
import {readEdiInput} from '../../lib/edi-input.js'

export default class PartnerReceive extends PlatformCommand<typeof PartnerReceive> {
  static description =
    "Hand the platform a raw EDI document from a partner, running the partner's inbound flow as if it had arrived over SFTP or AS2."

  static examples = [
    '<%= config.bin %> partner receive ACME 850.edi',
    'cat 850.edi | <%= config.bin %> partner receive ACME -',
  ]

  static args = {
    key: Args.string({description: 'Partner key the document is from.', required: true}),
    file: Args.string({description: "EDI file to process, or '-' for stdin.", required: true}),
  }

  static flags = {
    filename: Flags.string({description: 'Filename to record the document under (letters, numbers, ._-).'}),
  }

  async run(): Promise<PartnerReceiveReceipt> {
    // Direct stderr write: oclif silences logToStderr under --json, which
    // would leave an interactive `--json` run looking hung while stdin waits.
    const contents = await readEdiInput(this.args.file, (msg) => process.stderr.write(`${msg}\n`))

    const client = await this.getAuthedClient()
    const receipt = await client.partnerReceive(this.args.key, contents, this.flags.filename)

    this.log('Processing queued.')
    this.log(`  Trace ${receipt.traceGuid}`)
    this.log('Follow it with `tedi result list --trace <trace>` or `tedi feed list --trace <trace>`.')
    return receipt
  }
}
