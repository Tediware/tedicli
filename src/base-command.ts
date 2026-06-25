/**
 * Base class for all tedi commands. Centralizes config/credential/client wiring
 * and consistent error rendering so individual commands stay thin.
 */

import {Command, Flags, Interfaces} from '@oclif/core'

import {ConfigStore} from './lib/config-store.js'
import {createCredentialStore, CredentialStore} from './lib/credentials.js'
import {ApiClient, createApiClient} from './lib/api-client.js'
import {NotAuthenticatedError, TediError} from './lib/errors.js'

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
  (typeof BaseCommand)['baseFlags'] & T['flags']
>

export abstract class BaseCommand<T extends typeof Command> extends Command {
  // Disable oclif's built-in `--json`. Reference commands reject it with an
  // educational message (see X12Command); other commands opt back in explicitly.
  static enableJsonFlag = false

  static baseFlags = {
    'no-color': Flags.boolean({
      description: 'Disable colored output.',
      helpGroup: 'GLOBAL',
    }),
  }

  protected flags!: BaseFlags<T>
  protected args!: Interfaces.InferredArgs<T['args']>

  private _config?: ConfigStore
  private _creds?: CredentialStore

  protected get configStore(): ConfigStore {
    this._config ??= new ConfigStore(this.config.configDir)
    return this._config
  }

  protected get credentials(): CredentialStore {
    this._creds ??= createCredentialStore(this.config.configDir)
    return this._creds
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

  /** Build an API client using the configured base URL and stored token (if any). */
  protected async getClient(): Promise<ApiClient> {
    const baseUrl = await this.configStore.get('api.baseUrl')
    const stored = await this.credentials.get()
    return createApiClient({baseUrl, token: stored?.token})
  }

  /** Like getClient, but fails with a clear message when not authenticated. */
  protected async getAuthedClient(): Promise<ApiClient> {
    const stored = await this.credentials.get()
    if (!stored) throw new NotAuthenticatedError()
    const baseUrl = await this.configStore.get('api.baseUrl')
    return createApiClient({baseUrl, token: stored.token})
  }

  protected async catch(err: Error & {exitCode?: number}): Promise<unknown> {
    if (err instanceof TediError) {
      this.error(err.message, {exit: err.exitCode, suggestions: err.suggestions})
    }
    return super.catch(err)
  }
}
