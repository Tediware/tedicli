import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {PartnerReceiveReceipt} from '../../lib/platform.js'
import {readEdiInput} from '../../lib/edi-input.js'

export default class PartnerReceive extends PlatformCommand<typeof PartnerReceive> {
  static summary = "Hand the platform a raw EDI document from a partner, running the partner's inbound flow."

  static description = `Sends the document to the Tediware server, which processes it as if it had arrived over SFTP or AS2; a standard API key is required.

A document already received (same sender, same interchange control number) is accepted again and processed again, and a 997 is re-issued when the partner expects one. Once it is processed, 'tedi transaction get' and 'tedi trace' name the earlier transaction. A file missing its SE, GE or IEA trailers is refused before anything runs.`

  static examples = [
    '<%= config.bin %> partner receive ACME 850.edi',
    '<%= config.bin %> partner receive ACME - < 850.edi',
  ]

  static args = {
    key: Args.string({description: 'Partner key the document is from.', required: true}),
    file: Args.string({description: "EDI file to process, or '-' for stdin. Stdin is read when omitted on a pipe.", ignoreStdin: true}),
  }

  static flags = {
    filename: Flags.string({description: 'Filename to record the document under (letters, numbers, ._-).'}),
  }

  async run(): Promise<PartnerReceiveReceipt> {
    // Direct stderr write: oclif silences logToStderr under --json, which
    // would leave an interactive `--json` run looking hung while stdin waits.
    const contents = await readEdiInput(this.args.file, (msg) => process.stderr.write(`${msg}\n`))

    const client = await this.getAuthedClient()
    const receipt = await client.partnerReceive(this.requireId(this.args.key, 'partner key'), contents, this.flags.filename)

    this.log('Processing queued.')
    this.log(`  Trace ${receipt.traceGuid}`)
    this.log(`Follow it with: tedi trace ${receipt.traceGuid}`)
    return receipt
  }
}
