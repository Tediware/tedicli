/**
 * Local configuration store. Persists a small set of known dotted keys to a JSON
 * file in oclif's config directory. Reads layer environment overrides on top of
 * the persisted values so `TEDI_X12_RELEASE` etc. win without being written to disk.
 */

import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {writeFileAtomic} from './atomic-write.js'
import {TediError} from './errors.js'

export const DEFAULT_X12_RELEASE = '004010'
// API.md: production host is https://tediware.com; reference endpoints live
// under <base>/api/x12. Local development uses http://localhost:5004.
export const DEFAULT_API_BASE_URL = 'https://tediware.com'

/**
 * The known configuration keys. Keeping this explicit (rather than allowing
 * arbitrary keys) gives `config set` real validation and lets `config list`
 * show defaults. Each entry maps a dotted key to its env override and default.
 */
export const CONFIG_KEYS = {
  'x12.release': {env: 'TEDI_X12_RELEASE', default: DEFAULT_X12_RELEASE},
  'api.baseUrl': {env: 'TEDI_API_BASE_URL', default: DEFAULT_API_BASE_URL},
} as const

export type ConfigKey = keyof typeof CONFIG_KEYS

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_KEYS, key)
}

/** Throw a consistent, actionable error if `key` is not a known config key. */
export function assertConfigKey(key: string): asserts key is ConfigKey {
  if (!isConfigKey(key)) {
    throw new TediError(`Unknown configuration key: ${key}`, {
      suggestions: [`Valid keys: ${Object.keys(CONFIG_KEYS).join(', ')}`],
    })
  }
}

/**
 * Validate `api.baseUrl`.
 *
 * Exported on its own because the value has three sources and only one of them
 * passes through `config set`: `TEDI_API_BASE_URL` and a hand-edited config.json
 * reach the client directly. Without a check at the point of use, an unusable
 * value surfaces as a bare `TypeError: Invalid URL` from node's fetch.
 */
export function assertValidBaseUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TediError(`api.baseUrl is not a valid URL: ${value}`, {
      suggestions: [
        'Set it to a full URL including the scheme, e.g. `tedi config set api.baseUrl https://tediware.com`.',
        'Run `tedi config list` to see the effective value and where it comes from — TEDI_API_BASE_URL overrides the stored config.',
      ],
    })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TediError(`api.baseUrl must be an http or https URL, but its scheme is "${url.protocol}": ${value}`, {
      suggestions: ['Use https for the Tediware platform, or http for a local development server.'],
    })
  }
}

/**
 * Release codes are six digits (API.md: "`:release` is the release code, e.g.
 * `004010`"). Only the shape is checked: which six-digit codes actually exist is
 * the server's to answer, and an allowlist here would go stale the moment a
 * release is published. A well-formed but unknown code still round-trips to a
 * clean 404 pointing at `tedi x12 releases`.
 */
export function assertValidRelease(value: string): void {
  if (!/^\d{6}$/.test(value)) {
    throw new TediError(`x12.release must be a six-digit release code, e.g. 004010 — got: ${value}`, {
      suggestions: ['Run `tedi x12 releases` to list the releases the platform carries.'],
    })
  }
}

/** Validate a value before it is persisted, so a typo fails now rather than on the next lookup. */
export function assertConfigValue(key: ConfigKey, value: string): void {
  if (key === 'api.baseUrl') assertValidBaseUrl(value)
  if (key === 'x12.release') assertValidRelease(value)
}

export class ConfigStore {
  private readonly file: string
  private cache: Record<string, string> | undefined

  constructor(configDir: string) {
    this.file = join(configDir, 'config.json')
  }

  /** Resolve a key: env override > persisted value > built-in default. */
  async get(key: ConfigKey): Promise<string> {
    const spec = CONFIG_KEYS[key]
    const fromEnv = process.env[spec.env]
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
    const persisted = await this.load()
    return persisted[key] ?? spec.default
  }

  async set(key: ConfigKey, value: string): Promise<void> {
    const persisted = await this.load()
    persisted[key] = value
    await this.save(persisted)
  }

  async unset(key: ConfigKey): Promise<void> {
    const persisted = await this.load()
    delete persisted[key]
    await this.save(persisted)
  }

  /** All known keys with their effective value and source. */
  async list(): Promise<Array<{key: ConfigKey; value: string; source: 'env' | 'config' | 'default'}>> {
    const persisted = await this.load()
    return (Object.keys(CONFIG_KEYS) as ConfigKey[]).map((key) => {
      const spec = CONFIG_KEYS[key]
      const fromEnv = process.env[spec.env]
      if (fromEnv !== undefined && fromEnv !== '') return {key, value: fromEnv, source: 'env' as const}
      if (persisted[key] !== undefined) return {key, value: persisted[key]!, source: 'config' as const}
      return {key, value: spec.default, source: 'default' as const}
    })
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = {}
        return this.cache
      }
      throw err
    }

    try {
      this.cache = JSON.parse(raw) as Record<string, string>
    } catch {
      throw new TediError(`The tedi config file is not valid JSON: ${this.file}`, {
        suggestions: ['Fix the file by hand, or delete it to reset to defaults.'],
      })
    }
    return this.cache
  }

  private async save(data: Record<string, string>): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2) + '\n', 0o600)
    this.cache = data
  }
}
