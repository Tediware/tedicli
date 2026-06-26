/**
 * Error types shared across commands. These carry a user-facing message plus an
 * optional `suggestions` list that the base command renders as oclif help text.
 */

export class TediError extends Error {
  readonly suggestions: string[]
  readonly exitCode: number

  constructor(message: string, opts: {suggestions?: string[]; exitCode?: number} = {}) {
    super(message)
    this.name = 'TediError'
    this.suggestions = opts.suggestions ?? []
    this.exitCode = opts.exitCode ?? 1
  }
}

/** Raised when a command needs credentials but none are stored. */
export class NotAuthenticatedError extends TediError {
  constructor() {
    super('You are not signed in.', {
      suggestions: ['Run `tedi auth login` to authenticate with the Tediware platform.'],
      exitCode: 1,
    })
    this.name = 'NotAuthenticatedError'
  }
}

/**
 * Raised when the user requests `--json` for licensed X12 reference data. The
 * message is intentionally educational rather than a flat "unknown flag".
 */
export class JsonNotSupportedError extends TediError {
  constructor() {
    super(
      'X12 reference is available as `--format console` or `--format markdown`. ' +
        "Structured JSON isn't offered for licensed X12 reference data.",
      {exitCode: 1},
    )
    this.name = 'JsonNotSupportedError'
  }
}

/** Raised when the server rejects a request because service terms are not accepted. */
export class TermsNotAcceptedError extends TediError {
  constructor() {
    super('Your account has not accepted the current Tediware service terms.', {
      suggestions: ['Run `tedi auth login` to review and accept the latest terms.'],
      exitCode: 1,
    })
    this.name = 'TermsNotAcceptedError'
  }
}

/** Raised on a 403 when the key's organization has been disabled. */
export class AccountUnavailableError extends TediError {
  constructor() {
    super('This account is unavailable.', {
      suggestions: ['Contact Tediware support if you believe this is in error.'],
      exitCode: 1,
    })
    this.name = 'AccountUnavailableError'
  }
}

/** Raised on a 404 for an unknown release/segment/element/transaction code. */
export class NotFoundError extends TediError {
  constructor(kind: string, code: string, release: string) {
    super(`No ${kind} '${code}' in release ${release}.`, {
      suggestions: [`Run \`tedi x12 releases\` to list releases, or double-check the ${kind} code.`],
      exitCode: 1,
    })
    this.name = 'NotFoundError'
  }
}

/** Raised on a 429. Carries the server's Retry-After hint (whole seconds) when present. */
export class RateLimitedError extends TediError {
  readonly retryAfterSeconds?: number

  constructor(retryAfterSeconds?: number) {
    const wait =
      retryAfterSeconds !== undefined && retryAfterSeconds > 0 ? ` Try again in ${retryAfterSeconds}s.` : ''
    // Don't quote specific limits: they're server-side and tunable, and the CLI
    // can't see the counters — only the 429 and the Retry-After hint.
    super(`Rate limit exceeded.${wait}`, {
      suggestions: ["You're sending requests too quickly; wait a moment before retrying."],
      exitCode: 1,
    })
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Raised when the identity/whoami endpoint is requested but does not exist yet
 * (see API.md "Not available yet"). Commands catch this to degrade gracefully
 * rather than failing — the CLI still knows a key is stored locally.
 */
export class IdentityUnavailableError extends TediError {
  constructor() {
    super('The identity endpoint is not available yet.', {
      suggestions: [
        'Identity/whoami ships with the device-flow auth work (see API.md).',
        'To confirm a key actually authenticates, run `tedi x12 releases`.',
      ],
      exitCode: 1,
    })
    this.name = 'IdentityUnavailableError'
  }
}
