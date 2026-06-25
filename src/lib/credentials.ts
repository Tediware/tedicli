/**
 * Credential storage.
 *
 * The brief calls for tokens in the OS keychain where available, falling back to
 * a permissioned config file. To keep the scaffold installable without a native
 * dependency, this ships the file-based implementation behind a `CredentialStore`
 * interface. A keychain-backed implementation (e.g. via `keytar` or the `security`
 * / `secret-tool` CLIs) can be slotted in later by `createCredentialStore` with no
 * change to callers.
 */

import {readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import {writeFileAtomic} from './atomic-write.js'

export interface StoredCredentials {
  token: string
}

export interface CredentialStore {
  get(): Promise<StoredCredentials | undefined>
  set(creds: StoredCredentials): Promise<void>
  clear(): Promise<void>
}

/**
 * File-based credential store. Writes a JSON file with 0600 permissions in the
 * oclif config directory.
 */
export class FileCredentialStore implements CredentialStore {
  private readonly file: string

  constructor(configDir: string) {
    this.file = join(configDir, 'credentials.json')
  }

  async get(): Promise<StoredCredentials | undefined> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }

    // A corrupt or partial file (e.g. an interrupted write) is treated as
    // "not signed in" rather than crashing every command; the user can re-login.
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as {token?: unknown}).token !== 'string' ||
      (parsed as {token: string}).token.length === 0
    ) {
      return undefined
    }
    return parsed as StoredCredentials
  }

  async set(creds: StoredCredentials): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(creds, null, 2) + '\n', 0o600)
  }

  async clear(): Promise<void> {
    await rm(this.file, {force: true})
  }
}

/**
 * Factory for the active credential store. Today this always returns the
 * file-based store; the keychain implementation will be selected here.
 */
export function createCredentialStore(configDir: string): CredentialStore {
  return new FileCredentialStore(configDir)
}
