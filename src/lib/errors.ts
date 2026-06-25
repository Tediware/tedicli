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
