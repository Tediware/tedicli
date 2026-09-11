/**
 * Parsing for `--since`. Every timestamp the CLI prints is UTC, so the forms a
 * person types after reading one have to round-trip: a full ISO 8601 value
 * with a zone, a bare date, and the relative shorthands that are what people
 * reach for first. A zone-less datetime is refused rather than guessed at,
 * because the server would read it in its own zone and silently return
 * nothing.
 */

import {TediError} from './errors.js'

const RELATIVE = /^(\d+)\s*([smhdw])$/i
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?/
const ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

/**
 * Turn a `--since` value into the ISO 8601 UTC instant the server accepts.
 * `now` is injectable for tests.
 */
export function parseSince(value: string, now: Date = new Date()): string {
  const raw = value.trim()
  if (raw === '') throw sinceError(value, 'it is empty')

  const relative = RELATIVE.exec(raw)
  if (relative) {
    const amount = Number(relative[1])
    const unit = (relative[2] ?? '').toLowerCase()
    const then = new Date(now.getTime() - amount * (UNIT_MS[unit] ?? 0))
    if (Number.isNaN(then.getTime())) throw sinceError(value, 'that is further back than time goes')
    return then.toISOString()
  }

  if (BARE_DATE.test(raw)) return normalize(`${raw}T00:00:00Z`, value)

  if (DATETIME.test(raw)) {
    if (!ZONE.test(raw)) {
      throw new TediError(`--since ${value} names no time zone.`, {
        suggestions: [
          'Add Z for UTC (the zone every timestamp tedi prints is in), e.g. ' +
            `--since ${raw.replace(' ', 'T')}Z, or an offset like +02:00.`,
          'Relative forms work too: --since 30m, --since 2h, --since 3d.',
        ],
      })
    }
    return normalize(raw.replace(' ', 'T'), value)
  }

  throw sinceError(value, 'it is not a timestamp this command understands')
}

function normalize(iso: string, original: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) throw sinceError(original, 'it is not a valid date')
  return parsed.toISOString()
}

function sinceError(value: string, reason: string): TediError {
  return new TediError(`--since ${JSON.stringify(value)} was not understood: ${reason}.`, {
    suggestions: [
      'Use an ISO 8601 timestamp with a zone (2026-08-19T13:21:19Z), a bare date (2026-08-19, read as UTC midnight), or a relative form (30m, 2h, 3d).',
    ],
  })
}
