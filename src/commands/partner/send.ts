import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {PartnerSendReceipt, TraceDetail} from '../../lib/platform.js'
import {EXIT_DEFECT, TediError} from '../../lib/errors.js'
import {readJsonInput} from '../../lib/edi-input.js'
import {errorLines} from '../../lib/render.js'

/** How often `--wait` polls, and for how long. */
export const WAIT_INTERVAL_MS = 2000
export const WAIT_TIMEOUT_MS = 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default class PartnerSend extends PlatformCommand<typeof PartnerSend> {
  static summary = 'Submit your own JSON document for outbound EDI generation and delivery to a partner.'

  static description = `Sends the document to the Tediware server, which generates the EDI and delivers it; a standard API key is required.

The receipt means the document was accepted and queued. Validation and delivery run afterwards, so a document the partner's implementation refuses still gets a receipt and then an error on its trace. Pass --wait to poll the trace to its end and exit 1 on an error.`

  static examples = [
    '<%= config.bin %> partner send ACME 850 order.json',
    '<%= config.bin %> partner send ACME 856 shipment.json --wait',
    '<%= config.bin %> partner send ACME 850 < order.json',
  ]

  static args = {
    key: Args.string({description: 'Partner key (as configured in Tediware).', required: true}),
    set: Args.string({description: 'Transaction set to generate (e.g. 850).', required: true}),
    file: Args.string({description: "JSON document to submit, or '-' for stdin. Stdin is read when omitted on a pipe.", ignoreStdin: true}),
  }

  static flags = {
    filename: Flags.string({description: 'Filename to record and deliver under (letters, numbers, ._-).'}),
    wait: Flags.boolean({
      description: `Poll the trace every ${WAIT_INTERVAL_MS / 1000}s until processing ends (up to ${WAIT_TIMEOUT_MS / 1000}s). Exit 0 delivered, 1 on an error, 2 on timeout.`,
    }),
  }

  async run(): Promise<PartnerSendReceipt | (PartnerSendReceipt & {trace: TraceDetail})> {
    // Direct stderr write: oclif silences logToStderr under --json, and a
    // silenced hint leaves an interactive `--json` run looking hung while
    // stdin waits for EOF.
    const raw = await readJsonInput(this.args.file, (message) => process.stderr.write(`${message}\n`))

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
    const receipt = await client.partnerSend(this.requireId(this.args.key, 'partner key'), this.requireId(this.args.set, 'transaction set'), contents, this.flags.filename)

    this.log('Processing queued.')
    this.log(`  Interchange ${receipt.interchangeControlNumber} / group ${receipt.groupControlNumber}`)
    this.log(`  Transaction ${receipt.ediTransactionId}`)
    this.log(`  Trace       ${receipt.traceGuid}`)
    if (!this.flags.wait) {
      this.log(`Follow it with: tedi trace ${receipt.traceGuid}`)
      return receipt
    }

    const trace = await this.waitForTrace(client, receipt.traceGuid)
    return {...receipt, trace}
  }

  /**
   * Poll the trace until `processing` is false. An error result on the trace
   * is the verdict the fire-and-forget receipt cannot give, so it exits 1 with
   * the error and its findings; a delivered outcome exits 0. Running out of
   * time says nothing about the document, so it exits 2 and names the trace.
   */
  private async waitForTrace(client: Awaited<ReturnType<PlatformCommand<typeof PartnerSend>['getAuthedClient']>>, guid: string): Promise<TraceDetail> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS
    if (!this.jsonEnabled()) this.logToStderr(`Waiting for trace ${guid} (polling every ${WAIT_INTERVAL_MS / 1000}s, up to ${WAIT_TIMEOUT_MS / 1000}s)...`)
    for (;;) {
      await sleep(WAIT_INTERVAL_MS)
      const trace = await client.traceGet(guid)
      if (!trace.processing) {
        const errored = trace.results.find((r) => r.status === 'error')
        if (errored) {
          this.log(`Error at ${errored.nodeName ?? 'unknown node'}:`)
          for (const line of errorLines(errored.detail)) this.log(`  ${line}`)
          this.log(`Details: tedi trace ${guid}`)
          process.exitCode = EXIT_DEFECT
        } else {
          this.log(`Delivered. Details: tedi trace ${guid}`)
        }
        return trace
      }
      if (Date.now() >= deadline) {
        throw new TediError(`Trace ${guid} is still processing after ${WAIT_TIMEOUT_MS / 1000}s.`, {
          suggestions: [`Check it later with \`tedi trace ${guid}\`.`],
        })
      }
    }
  }
}
