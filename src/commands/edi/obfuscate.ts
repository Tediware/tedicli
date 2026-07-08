import {readFile} from 'node:fs/promises'

import {Args, Flags} from '@oclif/core'

import {BaseCommand} from '../../base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {obfuscateInterchange} from '../../lib/edi-obfuscate.js'
import {TediError} from '../../lib/errors.js'
import {readStdin} from '../../lib/prompt.js'

export default class EdiObfuscate extends BaseCommand<typeof EdiObfuscate> {
  static summary = 'Obfuscate personal data in an X12 EDI file. Runs entirely locally.'

  static description = `The scrub runs entirely on your machine — your file never leaves it, and no API key is needed.

Replaces personally identifying values with format-preserving fakes: person names, street addresses, city/ZIP, dates of birth (year is kept), phone/fax/email, SSNs, member and medical-record identifiers, patient account numbers, bank routing/account numbers, and free-text notes. The same value always maps to the same replacement within a run, so cross-segment references stay intact.

Everything structural is preserved byte-for-byte: delimiters, qualifiers, code values, dates of service, monetary amounts, control numbers, segment counts, and element lengths (including the fixed-width ISA header). Business identifiers — sender/receiver routing IDs, organization names, NPIs, tax IDs — are kept so the file stays debuggable.

Replacements are randomized on every run; pass --seed to make them reproducible.`

  static examples = [
    '<%= config.bin %> edi obfuscate claims.edi > claims.scrubbed.edi',
    '<%= config.bin %> edi obfuscate claims.edi -o claims.scrubbed.edi',
    'cat claims.edi | <%= config.bin %> edi obfuscate -',
    '<%= config.bin %> edi obfuscate claims.edi --seed my-seed -o claims.scrubbed.edi',
  ]

  static args = {
    file: Args.string({description: "Path to the EDI file, or '-' to read from stdin.", required: true}),
  }

  static flags = {
    output: Flags.string({
      char: 'o',
      description: 'Write the obfuscated interchange to this file instead of stdout.',
    }),
    seed: Flags.string({
      description: 'Derive replacements from this seed so repeated runs produce identical output.',
    }),
  }

  async run(): Promise<void> {
    if (this.args.file === '-' && process.stdin.isTTY) {
      this.logToStderr('Reading EDI from the terminal — paste the interchange, then press Ctrl+D.')
    }
    const input = await this.readInput(this.args.file)
    const {output, valuesObfuscated, segmentCount} = obfuscateInterchange(input, {seed: this.flags.seed})
    const summary = `Obfuscated ${valuesObfuscated} value${valuesObfuscated === 1 ? '' : 's'} across ${segmentCount} segments.`

    if (this.flags.output) {
      // Atomic so a crash or full disk can't leave a truncated (or worse,
      // partially scrubbed-looking) file at the target path.
      await writeFileAtomic(this.flags.output, output, 0o644)
      this.log(`Wrote ${this.flags.output}. ${summary}`)
    } else {
      process.stdout.write(output)
      // The summary goes to stderr so redirected/piped EDI output stays clean.
      this.logToStderr(summary)
    }
  }

  private async readInput(file: string): Promise<string> {
    if (file === '-') return readStdin()

    try {
      return await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TediError(`File not found: ${file}`)
      }
      throw err
    }
  }
}
