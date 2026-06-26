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
