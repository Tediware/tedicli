import {Args, Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {readEdiDocument} from '../../lib/edi-input.js'
import {describeObfuscation, obfuscateInterchange} from '../../lib/edi-obfuscate.js'

export default class EdiObfuscate extends BaseCommand<typeof EdiObfuscate> {
  static summary = 'Obfuscate personal data in an X12 EDI file. Runs entirely locally.'

  static description = `Local. Nothing is sent: your file never leaves the machine, and no API key is needed.

Replaces personal values with format-preserving fakes: person names and the addresses under them, dates of birth (year kept), phone/fax/email, SSNs, member and medical-record identifiers, patient account numbers, and bank routing/account numbers. The same value always maps to the same replacement within a run, so cross-segment references stay intact.

The defaults were designed for two document families. Healthcare claims and enrollment (837, 834, 835, 270/271) scrub fully, free text included, because every party is a person. Supply-chain purchase orders, shipments and invoices (850, 856, 810) keep business parties, their addresses and their free text, because that is what a supplier debugging a ship-to needs. Two flags move the line: --scrub-parties treats every N1 ship-to and bill-to as a person (drop-ship orders), and --scrub-text scrubs MSG, MTX, NTE and K3 on any document.

Everything structural is preserved byte-for-byte: delimiters, qualifiers, code values, dates of service, monetary amounts, control numbers, segment counts, and element lengths (including the fixed-width ISA header). Business identifiers (sender/receiver routing IDs, organization names, NPIs, tax IDs) are kept so the file stays debuggable.

Faults in a value are preserved as well: each replacement is invalid in the same way the value it replaces was. A date of birth that is not a real date stays impossible rather than being replaced by a valid one, and a date range that ran backwards still does, so a scrubbed file reproduces the problem you are chasing. Relationships between different values are not preserved (a date of birth after the date of service, say), since the two are scrubbed independently.

Replacements are randomized on every run; pass --seed to make them reproducible. This is a best-effort scrub for sharing files in debugging contexts, not a certified de-identification.`

  static examples = [
    '<%= config.bin %> edi obfuscate claims.edi > claims.scrubbed.edi',
    '<%= config.bin %> edi obfuscate claims.edi -o claims.scrubbed.edi',
    '<%= config.bin %> edi obfuscate - < claims.edi',
    '<%= config.bin %> edi obfuscate order.edi --scrub-parties',
    '<%= config.bin %> edi obfuscate claims.edi --seed my-seed -o claims.scrubbed.edi',
  ]

  static args = {
    file: Args.string({
      description: "Path to the EDI file, or '-' for stdin. Stdin is also read when the argument is omitted on a pipe.",
      ignoreStdin: true,
    }),
  }

  static flags = {
    output: Flags.string({
      char: 'o',
      description: "Write the obfuscated interchange to this file instead of stdout ('-' is stdout).",
    }),
    seed: Flags.string({
      description: 'Derive replacements from this seed so repeated runs produce identical output. An empty seed means no seed.',
    }),
    'scrub-parties': Flags.boolean({
      description: 'Treat every N1 ship-to (ST) and bill-to (BT) party as a person: scrub the name with its N3, N4 and PER.',
    }),
    'scrub-text': Flags.boolean({
      description: 'Scrub free text (MSG, MTX, NTE, K3) on any document, not only when the interchange carries person segments.',
    }),
  }

  async run(): Promise<void> {
    const {text: input, encoding} = await readEdiDocument(this.args.file, (message) => this.logToStderr(message))
    const result = obfuscateInterchange(input, {
      seed: this.flags.seed,
      scrubParties: this.flags['scrub-parties'],
      scrubText: this.flags['scrub-text'],
    })
    const {output} = result
    const summary = `${describeObfuscation(result)}.`

    if (this.flags.output && this.flags.output !== '-') {
      // Atomic so a crash or full disk can't leave a truncated (or worse,
      // partially scrubbed-looking) file at the target path. Written back in
      // the encoding it was read in, so untouched bytes are the same bytes.
      await writeFileAtomic(this.flags.output, output, 0o644, encoding)
      this.log(`Wrote ${this.flags.output}. ${summary}`)
      return
    }

    process.stdout.write(Buffer.from(output, encoding))
    // On a terminal the summary would otherwise start on the tail of an EDI
    // that ends without a newline. A pipe gets the bytes untouched.
    if (process.stdout.isTTY && !output.endsWith('\n')) process.stdout.write('\n')
    // The summary goes to stderr so redirected/piped EDI output stays clean.
    this.logToStderr(summary)
  }
}
