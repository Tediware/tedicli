/**
 * Base class for the read-only `x12` reference commands. Adds the shared
 * `--release/-r` and `--format` flags, resolves the effective release, enforces
 * the "no JSON for licensed reference data" policy, and prints server-rendered
 * output.
 */

import {Command, Flags, Interfaces} from '@oclif/core'

import {BaseCommand} from './base-command.js'
import {CodeLimit, ReferenceRequest, RenderedReference} from './lib/api-client.js'
import {JsonNotSupportedError, TediError} from './lib/errors.js'
import {wantsColor} from './lib/output.js'

export const SERVER_LOOKUP = 'Looks the answer up on the Tediware server; an API key is required.'

export abstract class X12Command<T extends typeof Command> extends BaseCommand<T> {
  // Re-type `flags` to include this class's own baseFlags so commands get fully
  // typed access to release/format/json/color without unchecked casts.
  protected declare flags: Interfaces.InferredFlags<(typeof X12Command)['baseFlags'] & T['flags']>

  static baseFlags = {
    ...BaseCommand.baseFlags,
    release: Flags.string({
      char: 'r',
      description: 'X12 release to look up (e.g. 004010, 005010). Defaults to config x12.release.',
    }),
    format: Flags.option({
      options: ['console', 'markdown'] as const,
      default: 'console',
      description: 'Output format. Licensed reference data is presentation-only; JSON is not offered.',
    })(),
    // Declared so `--json` parses to a friendly, educational error rather than
    // oclif's generic "Nonexistent flag" failure. Hidden from help.
    json: Flags.boolean({hidden: true}),
  }

  /** Resolve the release to use: --release flag, then env/config/default. */
  protected async resolveRelease(): Promise<string> {
    if (this.flags.release) return this.flags.release
    return this.configStore.get('x12.release')
  }

  /**
   * A reference id as typed, trimmed and shape-checked. An empty or
   * space-bearing id is misuse of the command (exit 2), not a verdict about
   * the standard, so it never reaches the server to come back as "no such
   * code" (exit 1).
   */
  protected referenceId(raw: string, what: string): string {
    const id = raw.trim().toUpperCase()
    if (id === '' || /\s/.test(id)) {
      throw new TediError(`${JSON.stringify(raw)} is not a ${what}.`, {
        suggestions: [`Pass one ${what} with no spaces, e.g. \`tedi x12 ${this.id?.split(':').pop()} ${what === 'segment id' ? 'N1' : what === 'element id' ? '235' : '856'}\`.`],
      })
    }
    return id
  }

  /**
   * Build a ReferenceRequest, rejecting `--json` and computing color intent.
   *
   * `codeLimit` is only meaningful for element lookups, so the command that has
   * the flags passes it in rather than every reference command carrying them.
   */
  protected async referenceRequest(opts: {codeLimit?: CodeLimit} = {}): Promise<ReferenceRequest> {
    if (this.flags.json) throw new JsonNotSupportedError()
    const format = this.flags.format
    const release = await this.resolveRelease()
    return {
      release,
      format,
      color: wantsColor(format, {noColorFlag: this.noColorFlag, colorFlag: this.colorFlag}),
      codeLimit: opts.codeLimit,
    }
  }

  /**
   * Print a server-rendered reference document.
   *
   * Note: the brief requires every reference response to echo the release used.
   * Today that echo lives in the server-rendered `body` (see MockApiClient). Once
   * the real rendering contract is fixed, enforce/verify the echo here against
   * `doc.release` rather than trusting the body.
   */
  protected printReference(doc: RenderedReference): void {
    this.log(doc.body)
  }
}
