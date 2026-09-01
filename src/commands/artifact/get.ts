import {writeFile} from 'node:fs/promises'
import {basename} from 'node:path'

import {Args, Flags} from '@oclif/core'

import {PlatformCommand} from '../../platform-base-command.js'
import {TediError} from '../../lib/errors.js'

export default class ArtifactGet extends PlatformCommand<typeof ArtifactGet> {
  // The payload is raw bytes; a JSON wrapper would just base64 it for no one.
  // The flag still parses (hidden below) so it fails with the reasoning
  // rather than oclif's "Nonexistent flag".
  static enableJsonFlag = false

  static description = 'Download a stored artifact (the raw document bytes) to stdout or a file.'

  static examples = [
    '<%= config.bin %> artifact get 9c1b2a3d-... -o document.edi',
    '<%= config.bin %> artifact get 9c1b2a3d-... > document.edi',
  ]

  static args = {
    id: Args.string({description: 'Artifact id (from `transaction get`, `result get`, or a webhook).', required: true}),
  }

  static flags = {
    output: Flags.string({
      char: 'o',
      description: "Write to this file instead of stdout. `-o auto` uses the artifact's own filename.",
    }),
    json: Flags.boolean({hidden: true}),
  }

  async run(): Promise<void> {
    if (this.flags.json) {
      throw new TediError('artifact get writes the raw document bytes; there is no JSON wrapper.', {
        suggestions: ['Pipe stdout, or use `-o <file>` to save it.'],
      })
    }

    const client = await this.getAuthedClient()
    const artifact = await client.artifactGet(this.args.id)

    let target = this.flags.output
    if (target === 'auto') {
      // basename() because the name is server-supplied: a hostile or buggy
      // server must not steer the write outside the working directory.
      target = basename(artifact.filename ?? `${this.args.id}.bin`)
    }

    if (target) {
      await writeFile(target, artifact.bytes)
      this.log(`Wrote ${artifact.bytes.length} bytes to ${target}.`)
      return
    }

    process.stdout.write(artifact.bytes)
  }
}
