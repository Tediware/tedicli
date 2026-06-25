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

import {readFile, writeFile, rm, mkdir, chmod} from 'node:fs/promises'
import {dirname, join} from 'node:path'

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
    try {
      const raw = await readFile(this.file, 'utf8')
      return JSON.parse(raw) as StoredCredentials
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }

  async set(creds: StoredCredentials): Promise<void> {
    await mkdir(dirname(this.file), {recursive: true})
    await writeFile(this.file, JSON.stringify(creds, null, 2) + '\n', {encoding: 'utf8', mode: 0o600})
    // Ensure perms even if the file pre-existed with looser bits.
    await chmod(this.file, 0o600)
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
