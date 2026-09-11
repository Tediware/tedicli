import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {MappingDetail, MappingVersion} from '../../lib/platform.js'
import {cell, formatTime} from '../../lib/table.js'

export default class MappingGet extends PlatformCommand<typeof MappingGet> {
  static summary = 'Show one mapping: what it targets and reads from, its version, and the transformation itself.'

  static description = `${SERVER_DATA}

Prints the current version's transformation in a fenced block. --version reads an earlier version instead (see \`mapping versions\`). -o writes the transformation text alone, so it can be edited and diffed. Under --json the response is the server's mapping shape unchanged; with --version it is that version's shape.`

  static examples = [
    '<%= config.bin %> mapping get 9c1b2a3d-...',
    '<%= config.bin %> mapping get 9c1b2a3d-... --version 2',
    '<%= config.bin %> mapping get 9c1b2a3d-... -o acme-856.jsonata',
  ]

  static args = {
    id: Args.string({description: 'Mapping id (from `mapping list` or `partner get`).', required: true}),
  }

  static flags = {
    version: Flags.integer({description: 'A version number from `mapping versions`, instead of the current one.', min: 1}),
    output: Flags.string({char: 'o', description: 'Write the transformation text to this file; `-o -` prints it alone to stdout.'}),
  }

  async run(): Promise<MappingDetail | MappingVersion> {
    const client = await this.getAuthedClient()
    const id = this.requireId(this.args.id, 'mapping id')

    // The mapping first, even under --version: the header is the mapping's,
    // and a missing mapping is then reported as such rather than as a
    // missing version of it.
    const m = await client.mappingGet(id)
    const version = this.flags.version === undefined ? m.current : await client.mappingVersion(id, this.flags.version)

    await this.emit(version?.transformation ?? '', () => {
      this.log(`${m.name}  (${m.direction})`)
      this.log(`Id             ${m.id}`)
      if (m.description) this.log(`Description    ${m.description}`)
      if (m.tags.length > 0) this.log(`Tags           ${m.tags.join(', ')}`)
      this.log(`Implementation ${m.implementation ? `${m.implementation.name} (${m.implementation.id})` : '-'}`)
      this.log(`Source  ${m.source ? `${m.source.name} (${m.source.id})` : '-'}`)
      this.log(`Partners       ${m.partners.join(', ') || '-'}`)
      if (version) this.logVersion(version)
      else this.log('Transformation none yet')
    })
    return this.flags.version === undefined ? m : (version as MappingVersion)
  }

  /** The transformation alone to a file or stdout when -o is given; the full view otherwise. */
  private async emit(transformation: string, view: () => void): Promise<void> {
    const target = this.flags.output
    if (target === undefined) {
      view()
      return
    }
    if (target === '-') {
      // Under --json, stdout belongs to the JSON oclif prints from run().
      if (this.jsonEnabled()) return
      process.stdout.write(transformation)
      if (process.stdout.isTTY && !transformation.endsWith('\n')) process.stdout.write('\n')
      return
    }
    await writeFileAtomic(target, transformation, 0o644)
    this.log(`Wrote ${Buffer.byteLength(transformation)} bytes to ${target}.`)
  }

  private logVersion(v: MappingVersion): void {
    this.log(`Version        ${v.versionNumber ?? '(unversioned)'}${v.note ? `, ${v.note}` : ''}`)
    this.log(`Saved          ${formatTime(v.createdAt)}${v.createdBy ? ` by ${v.createdBy.name}` : ''}`)
    this.log(`Placeholders   ${v.placeholders.length}`)
    for (const p of v.placeholders) {
      this.log(`  line ${p.line}, column ${p.column}: ${JSON.stringify(p.value)}${p.reason ? ` (${p.reason})` : ''}`)
    }
    this.log('')
    this.log('```')
    this.log(cell(v.transformation))
    this.log('```')
  }
}
