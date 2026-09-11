/**
 * Local configuration store. Persists a small set of known dotted keys to a JSON
 * file in oclif's config directory. Reads layer environment overrides on top of
 * the persisted values so `TEDI_X12_RELEASE` etc. win without being written to disk.
 */

import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {writeFileAtomic} from './atomic-write.js'
import {FileAccessError, TediError} from './errors.js'

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
 * The directory a `--profile` name resolves to. Profiles sit beside oclif's
 * own config dir: `~/.tedi-profiles/<name>`, or under `$XDG_CONFIG_HOME` when
 * that is set, the way oclif places `tedi/` itself.
 */
export function profileDir(name: string, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new TediError(`Invalid profile name: ${JSON.stringify(name)}`, {
      suggestions: ['Profile names are letters, digits, dots, dashes and underscores, e.g. `--profile staging`.'],
    })
  }
  const xdg = env.XDG_CONFIG_HOME
  return xdg ? join(xdg, 'tedi-profiles', name) : join(home, '.tedi-profiles', name)
}

/**
 * Validate `api.baseUrl` and return it normalized (no trailing slash).
 *
 * Exported on its own because the value has three sources and only one of them
 * passes through `config set`: `TEDI_API_BASE_URL` and a hand-edited config.json
 * reach the client directly. Without a check at the point of use, an unusable
 * value surfaces as a bare `TypeError: Invalid URL` from node's fetch.
 *
 * Only the scheme and host (with an optional port) are accepted. A path on the
 * base URL is the most common way to end up with every endpoint answering 404,
 * so it is refused here rather than diagnosed later.
 */
export function assertValidBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TediError(`api.baseUrl is not a valid URL: ${value}`, {
      suggestions: [
        'Set it to a full URL including the scheme, e.g. `tedi config set api.baseUrl https://tediware.com`.',
        'Run `tedi config list` to see the effective value and where it comes from. TEDI_API_BASE_URL overrides the stored config.',
      ],
    })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TediError(`api.baseUrl must be an http or https URL, but its scheme is "${url.protocol}": ${value}`, {
      suggestions: ['Use https for the Tediware platform, or http for a local development server.'],
    })
  }

  const problems: string[] = []
  if (url.username || url.password) problems.push('a username or password')
  if (url.pathname !== '/' && url.pathname !== '') problems.push(`a path (${url.pathname})`)
  if (url.search) problems.push('a query string')
  if (url.hash) problems.push('a fragment')
  if (problems.length > 0) {
    throw new TediError(`api.baseUrl must be the scheme and host only, but ${value} carries ${problems.join(', ')}.`, {
      suggestions: [
        `Use ${url.protocol}//${url.host} instead. The CLI adds /api, /platform and /mcp itself.`,
      ],
    })
  }

  return `${url.protocol}//${url.host}`
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
    throw new TediError(`x12.release must be a six-digit release code such as 004010, not ${value}.`, {
      suggestions: ['Run `tedi x12 releases` to list the releases the platform carries.'],
    })
  }
}

/** Validate a value before it is persisted, returning the form to store. */
export function normalizeConfigValue(key: ConfigKey, value: string): string {
  if (key === 'api.baseUrl') return assertValidBaseUrl(value)
  if (key === 'x12.release') assertValidRelease(value)
  return value
}

/** The problem with a configured value, or undefined when it is usable. */
export function configValueProblem(key: ConfigKey, value: string): string | undefined {
  try {
    normalizeConfigValue(key, value)
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export interface ConfigEntry {
  key: ConfigKey
  value: string
  source: 'env' | 'config' | 'default'
  /** Set when the effective value would be refused at the point of use. */
  problem?: string
}

export class ConfigStore {
  readonly file: string
  private cache: Record<string, string> | undefined

  constructor(readonly configDir: string) {
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

  /** Remove a persisted value. Returns whether one was there to remove. */
  async unset(key: ConfigKey): Promise<boolean> {
    const persisted = await this.load()
    const had = key in persisted
    delete persisted[key]
    await this.save(persisted)
    return had
  }

  /** All known keys with their effective value, source, and any problem with it. */
  async list(): Promise<ConfigEntry[]> {
    const persisted = await this.load()
    return (Object.keys(CONFIG_KEYS) as ConfigKey[]).map((key) => {
      const spec = CONFIG_KEYS[key]
      const fromEnv = process.env[spec.env]
      const entry: ConfigEntry =
        fromEnv !== undefined && fromEnv !== ''
          ? {key, value: fromEnv, source: 'env'}
          : persisted[key] !== undefined
            ? {key, value: persisted[key]!, source: 'config'}
            : {key, value: spec.default, source: 'default'}
      const problem = configValueProblem(key, entry.value)
      if (problem) entry.problem = problem
      return entry
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
      throw new FileAccessError('read', this.file, err)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new TediError(`The tedi config file is not valid JSON: ${this.file}`, {
        suggestions: ['Fix the file by hand, or delete it to reset to defaults.'],
      })
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TediError(`The tedi config file is not a JSON object: ${this.file}`, {
        suggestions: ['Fix the file by hand, or delete it to reset to defaults.'],
      })
    }

    // A hand-edited file can hold anything. Values are read as strings
    // everywhere, so a number or an object here would surface far from its
    // cause; say which key is wrong and where.
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new TediError(`The tedi config file has a non-string value for ${key}: ${this.file}`, {
          suggestions: [
            `Config values are strings, e.g. "${key}": "${String(value)}". Fix the file by hand, or delete it to reset to defaults.`,
          ],
        })
      }
    }

    this.cache = parsed as Record<string, string>
    return this.cache
  }

  private async save(data: Record<string, string>): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2) + '\n', 0o600)
    this.cache = data
  }
}
