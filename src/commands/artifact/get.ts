import {basename} from 'node:path'

import {Args, Flags} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {writeFileAtomic} from '../../lib/atomic-write.js'
import {JsonNotOfferedError, TediError} from '../../lib/errors.js'
import {isTextContentType} from '../../lib/output.js'

export default class ArtifactGet extends PlatformCommand<typeof ArtifactGet> {
  // The payload is raw bytes; a JSON wrapper would just base64 it for no one.
  // The flag still parses (hidden below) so it fails with the reasoning
  // rather than oclif's "Nonexistent flag".
  static enableJsonFlag = false

  static summary = 'Download a stored artifact (the raw document bytes) to stdout or a file.'

  static description = `${SERVER_DATA}

On a terminal, a text artifact (EDI, JSON, XML) prints with a trailing newline and a binary one is refused; pipe stdout or pass -o to get the exact bytes.`

  static examples = [
    '<%= config.bin %> artifact get 9c1b2a3d-... -o document.edi',
    '<%= config.bin %> artifact get 9c1b2a3d-... -o auto',
    '<%= config.bin %> artifact get 9c1b2a3d-... > document.edi',
  ]

  static args = {
    id: Args.string({description: 'Artifact id (from `transaction get`, `result get`, `trace`, or a webhook).', required: true}),
  }

  static flags = {
    output: Flags.string({
      char: 'o',
      description: "Write to this file instead of stdout. `-o auto` uses the artifact's own filename; `-o -` is stdout.",
    }),
    json: Flags.boolean({hidden: true}),
  }

  async run(): Promise<void> {
    if (this.flags.json) {
      throw new JsonNotOfferedError('the artifact is raw document bytes.', ['Pipe stdout, or write it with -o <file>.'])
    }

    const client = await this.getAuthedClient()
    const id = this.requireId(this.args.id, 'artifact id')
    const artifact = await client.artifactGet(id)

    const toStdout = !this.flags.output || this.flags.output === '-'
    let target = this.flags.output
    if (target === 'auto') {
      // basename() because the name is server-supplied: a hostile or buggy
      // server must not steer the write outside the working directory, and a
      // name that reduces to nothing usable falls back to the id.
      const name = basename(artifact.filename ?? '')
      target = name && name !== '.' && name !== '..' && name !== '-' ? name : `${id}.bin`
    }

    if (!toStdout && target) {
      await writeFileAtomic(target, artifact.bytes, 0o644)
      this.log(`Wrote ${artifact.bytes.length} bytes to ${target}.`)
      return
    }

    if (process.stdout.isTTY) {
      if (!isTextContentType(artifact.contentType)) {
        throw new TediError(`This is a binary artifact (${artifact.contentType ?? 'unknown type'}); use -o to save it.`, {
          suggestions: [`tedi artifact get ${this.args.id} -o ${artifact.filename ?? 'artifact.bin'}`],
        })
      }
      process.stdout.write(artifact.bytes)
      if (artifact.bytes.at(-1) !== 0x0a) process.stdout.write('\n')
      return
    }

    process.stdout.write(artifact.bytes)
  }
}
