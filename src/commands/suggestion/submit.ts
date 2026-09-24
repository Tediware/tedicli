import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {TediError} from '../../lib/errors.js'
import {readDocumentBytes} from '../../lib/edi-input.js'
import {SUGGESTION_CATEGORIES, SuggestionInput, SuggestionReceipt} from '../../lib/platform.js'

export default class SuggestionSubmit extends PlatformCommand<typeof SuggestionSubmit> {
  static summary = 'Only for a confirmed gap in Tediware: report it to the Tediware team, with evidence.'

  static description = `Sends the suggestion to the Tediware team through the server; a standard or sandbox API key works.

Call this after you have checked the docs and tried the documented path, and have concrete evidence: a documented endpoint or tool that answers differently from its docs, a field or capability you needed that does not exist, or a doc that is wrong. Do not use it to report your own mistakes, to say thanks, to summarize a task, or to pass on general ideas.

Send one suggestion per distinct problem, and never resend one: a repeat within 24 hours returns the first and exits 0, and each organization may send 20 in 24 hours. The suggestion goes to the Tediware team, not to a trading partner, and no reply comes back. Do not include customer PII or document contents.

The body is the gap, read from a file or stdin. --tried and --expected are required.`

  static examples = [
    '<%= config.bin %> suggestion submit gap.md --tried "Called GET /platform/partners/ACME; no ISA ids in the response." --expected "The interchange sender and receiver ids." --category api',
    'echo "The mappings doc omits outbound 850 line items." | <%= config.bin %> suggestion submit --tried "Read /resources/docs/mappings." --expected "An example payload with two line items."',
  ]

  static args = {
    file: Args.string({description: "The gap, as text, or '-' for stdin. Stdin is read when omitted on a pipe.", ignoreStdin: true}),
  }

  static flags = {
    tried: Flags.string({description: 'What you did: the endpoint, tool or doc, and what came back.'}),
    expected: Flags.string({description: 'What you expected to find or get instead.'}),
    title: Flags.string({description: 'A short summary, up to 200 characters.'}),
    category: Flags.option({options: SUGGESTION_CATEGORIES, description: 'What kind of gap it is.'})(),
    reference: Flags.string({description: 'The doc page, URL, endpoint or command it is about.'}),
    trace: Flags.string({description: 'The trace GUID of a processed document that shows the problem.'}),
  }

  async run(): Promise<SuggestionReceipt> {
    const tried = required(this.flags.tried, '--tried', 'what you did, and what came back')
    const expected = required(this.flags.expected, '--expected', 'what you expected instead')

    const body = (
      await readDocumentBytes(this.args.file, {noun: 'suggestion', notify: (message) => process.stderr.write(`${message}\n`)})
    )
      .toString('utf8')
      .trim()
    if (body === '') {
      throw new TediError('The suggestion is empty.', {suggestions: ['Describe the gap in the file or on stdin.']})
    }

    const input: SuggestionInput = {body, tried, expected}
    if (this.flags.title) input.title = this.flags.title
    if (this.flags.category) input.category = this.flags.category
    if (this.flags.reference) input.reference = this.flags.reference
    if (this.flags.trace) input.traceGuid = this.flags.trace

    const client = await this.getAuthedClient()
    const receipt = await client.suggestionSubmit(input)

    if (receipt.duplicate) {
      this.log(`Already submitted as suggestion ${receipt.id} in the last 24 hours. Nothing new was sent.`)
    } else {
      this.log(`Submitted suggestion ${receipt.id}.`)
    }
    return receipt
  }
}

/** A required evidence flag, checked before anything is read or sent. */
function required(value: string | undefined, flag: string, what: string): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') {
    throw new TediError(`${flag} is required: ${what}.`, {
      suggestions: ['A suggestion needs the evidence for the gap. If you have none yet, check the docs and try the documented path first.'],
    })
  }
  return trimmed
}
