/**
 * Base class for the read-only `x12` reference commands. Adds the shared
 * `--release/-r` and `--format` flags, resolves the effective release, enforces
 * the "no JSON for licensed reference data" policy, and prints server-rendered
 * output.
 */

import {Command, Flags} from '@oclif/core'

import {BaseCommand} from './base-command.js'
import {ReferenceRequest, RenderedReference} from './lib/api-client.js'
import {JsonNotSupportedError} from './lib/errors.js'
import {OutputFormat, wantsColor} from './lib/output.js'

export abstract class X12Command<T extends typeof Command> extends BaseCommand<T> {
  static baseFlags = {
    ...BaseCommand.baseFlags,
    release: Flags.string({
      char: 'r',
      description: 'X12 release to look up (e.g. 004010, 005010). Defaults to config x12.release.',
      helpGroup: 'GLOBAL',
    }),
    format: Flags.option({
      options: ['console', 'markdown'] as const,
      default: 'console',
      description: 'Output format. Licensed reference data is presentation-only; JSON is not offered.',
      helpGroup: 'GLOBAL',
    })(),
    // Declared so `--json` parses to a friendly, educational error rather than
    // oclif's generic "Nonexistent flag" failure. Hidden from help.
    json: Flags.boolean({hidden: true}),
  }

  /** Resolve the release to use: --release flag, then env/config/default. */
  protected async resolveRelease(): Promise<string> {
    const fromFlag = (this.flags as {release?: string}).release
    if (fromFlag) return fromFlag
    return this.configStore.get('x12.release')
  }

  /** Build a ReferenceRequest, rejecting `--json` and computing color intent. */
  protected async referenceRequest(): Promise<ReferenceRequest> {
    const flags = this.flags as {json?: boolean; format?: OutputFormat; 'no-color'?: boolean}
    if (flags.json) throw new JsonNotSupportedError()
    const format = flags.format ?? 'console'
    const release = await this.resolveRelease()
    return {
      release,
      format,
      color: wantsColor(format, {noColorFlag: flags['no-color']}),
    }
  }

  /** Print a server-rendered reference document. */
  protected printReference(doc: RenderedReference): void {
    this.log(doc.body)
  }
}
