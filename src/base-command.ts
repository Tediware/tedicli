/**
 * Base class for all tedi commands. Centralizes config/credential/client wiring
 * and consistent error rendering so individual commands stay thin.
 */

import {Command, Flags, Interfaces} from '@oclif/core'

import {assertValidBaseUrl, ConfigStore, profileDir} from './lib/config-store.js'
import {API_KEY_ENV, createCredentialStore, CredentialStore} from './lib/credentials.js'
import {ApiClient, createApiClient} from './lib/api-client.js'
import {EXIT_UNUSABLE, NotAuthenticatedError, TediError} from './lib/errors.js'

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
  (typeof BaseCommand)['baseFlags'] & T['flags']
>

/** The effective API key plus where it came from, for accurate status messaging. */
export type ResolvedCredentials = {token: string; source: 'env' | 'stored'}

/** The shape every error takes on stdout under `--json`. */
export interface JsonError {
  error: {
    message: string
    code: string | null
    suggestions: string[]
    exitCode: number
  }
}

export abstract class BaseCommand<T extends typeof Command> extends Command {
  // Disable oclif's built-in `--json`. Reference commands reject it with an
  // educational message (see X12Command); other commands opt back in explicitly.
  static enableJsonFlag = false

  static baseFlags = {
    color: Flags.boolean({
      allowNo: true,
      description:
        'Force colored output on (for a pager such as `less -R`) or off. By default color is used only on a terminal.',
      helpGroup: 'GLOBAL',
    }),
    profile: Flags.string({
      description: 'Read config and credentials from the named profile (~/.tedi-profiles/<name>) instead of the default directory.',
      helpGroup: 'GLOBAL',
    }),
  }

  protected flags!: BaseFlags<T>
  protected args!: Interfaces.InferredArgs<T['args']>

  private _config?: ConfigStore
  private _creds?: CredentialStore

  /** The directory config and credentials are read from: the profile if one was named, else oclif's. */
  protected get configDir(): string {
    const profile = (this.flags as {profile?: string} | undefined)?.profile
    return profile ? profileDir(profile) : this.config.configDir
  }

  protected get configStore(): ConfigStore {
    this._config ??= new ConfigStore(this.configDir)
    return this._config
  }

  protected get credentials(): CredentialStore {
    this._creds ??= createCredentialStore(this.configDir)
    return this._creds
  }

  /** Whether `--no-color` was passed. */
  protected get noColorFlag(): boolean {
    return (this.flags as {color?: boolean}).color === false
  }

  /** Whether `--color` was passed. */
  protected get colorFlag(): boolean {
    return (this.flags as {color?: boolean}).color === true
  }

  /** What every request identifies itself as. */
  protected get userAgent(): string {
    return `tedi/${this.config.version} (${this.config.platform}-${this.config.arch} node-${process.version})`
  }

  public async init(): Promise<void> {
    await super.init()
    const {args, flags} = await this.parse({
      flags: this.ctor.flags,
      baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
      enableJsonFlag: this.ctor.enableJsonFlag,
      args: this.ctor.args,
      strict: this.ctor.strict,
    })
    this.flags = flags as BaseFlags<T>
    this.args = args as Interfaces.InferredArgs<T['args']>
  }

  /** The configured base URL, validated and normalized. */
  protected async baseUrl(): Promise<string> {
    const baseUrl = await this.configStore.get('api.baseUrl')
    // Checked here, not just in `config set`: the value can also arrive from
    // TEDI_API_BASE_URL or a hand-edited config.json, and an unusable one would
    // otherwise escape as a bare `TypeError: Invalid URL` out of fetch.
    return assertValidBaseUrl(baseUrl)
  }

  private async buildClient(token?: string): Promise<ApiClient> {
    return createApiClient({baseUrl: await this.baseUrl(), token, userAgent: this.userAgent})
  }

  /**
   * Resolve the effective API key: the `TEDI_API_KEY` env override wins, else the
   * stored credential. Returns undefined when neither is present.
   */
  protected async resolveCredentials(): Promise<ResolvedCredentials | undefined> {
    const fromEnv = process.env[API_KEY_ENV]?.trim()
    if (fromEnv) return {token: fromEnv, source: 'env'}
    const stored = await this.credentials.get()
    return stored ? {token: stored.token, source: 'stored'} : undefined
  }

  /** Build an API client using the configured base URL and resolved token (if any). */
  protected async getClient(): Promise<ApiClient> {
    const cred = await this.resolveCredentials()
    return this.buildClient(cred?.token)
  }

  /** Like getClient, but fails with a clear message when not authenticated. */
  protected async getAuthedClient(): Promise<ApiClient> {
    const cred = await this.resolveCredentials()
    if (!cred) throw new NotAuthenticatedError(await this.baseUrl())
    return this.buildClient(cred.token)
  }

  /**
   * Every failure leaves through here. A TediError carries its own exit code
   * and suggestions; oclif's own errors (a mistyped flag, a missing argument)
   * keep theirs; anything else is an unclassified failure, which by the exit
   * code contract is "could not run" (2), printed as one line without a stack.
   *
   * Under `--json` the error is the JSON on stdout, in one shape whatever the
   * cause, so a script parses one thing for both outcomes. Warnings still go
   * to stderr.
   */
  protected async catch(err: Error & {exitCode?: number; oclif?: {exit?: number | false}}): Promise<unknown> {
    if (err instanceof TediError) return this.fail(err.message, err.exitCode, err.suggestions, err.code ?? null)
    if (err.oclif !== undefined) {
      if (!this.jsonEnabled()) return super.catch(err)
      const exit = typeof err.oclif.exit === 'number' ? err.oclif.exit : EXIT_UNUSABLE
      return this.fail(oneLine(err.message), exit, [], null)
    }
    return this.fail(firstLine(err?.message) || String(err), EXIT_UNUSABLE, [], null)
  }

  private fail(message: string, exitCode: number, suggestions: string[], code: string | null): void {
    if (this.jsonEnabled()) {
      const body: JsonError = {error: {message, code, suggestions, exitCode}}
      // Written directly and left to drain: `this.exit()` would call
      // process.exit() under the buffered write. A parse failure never got to
      // mark the command parsed; returning normally would then earn oclif's
      // "did not parse its arguments" warning on stderr, so mark it here.
      process.stdout.write(JSON.stringify(body, null, 2) + '\n')
      process.exitCode = exitCode
      ;(this as {parsed?: boolean}).parsed = true
      return
    }
    this.error(message, {exit: exitCode, suggestions})
  }
}

function firstLine(text: string | undefined): string {
  return (text ?? '').split('\n')[0]?.trim() ?? ''
}

/** An oclif parse error on one line, without its trailing help pointer. */
function oneLine(text: string | undefined): string {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^See more help with --help$/.test(l))
    .join(' ')
}
