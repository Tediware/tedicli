/**
 * Error types shared across commands. These carry a user-facing message plus an
 * optional `suggestions` list that the base command renders as oclif help text.
 */

/**
 * The document was examined and the answer is bad: `edi inspect` found errors in
 * it, or the server could not read it as EDI, or a reference lookup came back
 * empty. Something was learned and the user can act on it.
 */
export const EXIT_DEFECT = 1

/**
 * Nothing was learned: the command could not run at all (no credentials, rate
 * limited, transport failure, a fault on either side, a misused flag). This is
 * also oclif's own default exit code, so a mistyped flag already lands here.
 *
 * The split matters in CI. A gate that reads every non-zero exit as "this file
 * is broken" reports an expired API key as a broken file; keeping "could not
 * run" at 2 is what lets a build tell those apart.
 */
export const EXIT_UNUSABLE = 2

export class TediError extends Error {
  readonly suggestions: string[]
  readonly exitCode: number

  constructor(message: string, opts: {suggestions?: string[]; exitCode?: number} = {}) {
    super(message)
    this.name = 'TediError'
    this.suggestions = opts.suggestions ?? []
    // Default to "could not run". An unclassified failure has, by definition,
    // not established anything about the user's document, and mislabeling one as
    // a defect is the more damaging direction of the two.
    this.exitCode = opts.exitCode ?? EXIT_UNUSABLE
  }
}

/** Raised when a command needs credentials but none are stored. */
export class NotAuthenticatedError extends TediError {
  constructor() {
    super('You are not signed in.', {
      suggestions: [
        'Get a key at https://tediware.com/app/api-keys then run `tedi auth login` to authenticate with Tediware.',
      ],
    })
    this.name = 'NotAuthenticatedError'
  }
}

/**
 * Raised on a server 401 when a key WAS sent but the server rejected it. This is
 * distinct from NotAuthenticatedError (no key stored at all): here a credential is
 * present, so the problem is the key's validity or the server it was sent to. The
 * most common cause is an `api.baseUrl` pointed at a server that didn't issue the
 * key (e.g. a local dev server vs. production), which otherwise masquerades as a
 * confusing "you are not signed in" despite a stored key.
 */
export class InvalidApiKeyError extends TediError {
  constructor(baseUrl?: string) {
    const where = baseUrl ? ` by the server at ${baseUrl}` : ''
    super(`Your API key was rejected${where} (HTTP 401).`, {
      suggestions: [
        baseUrl
          ? `Check that api.baseUrl is the server that issued the key — currently ${baseUrl} (\`tedi config get api.baseUrl\`).`
          : 'Check that api.baseUrl points at the server that issued the key (`tedi config get api.baseUrl`).',
        'If the URL is correct, the key may be wrong or revoked — re-run `tedi auth login`, or check TEDI_API_KEY if it is set.',
      ],
    })
    this.name = 'InvalidApiKeyError'
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
    )
    this.name = 'JsonNotSupportedError'
  }
}

/** Raised when the server rejects a request because service terms are not accepted. */
export class TermsNotAcceptedError extends TediError {
  constructor() {
    super('Your account has not accepted the current Tediware service terms.', {
      suggestions: ['Run `tedi auth login` to review and accept the latest terms.'],
    })
    this.name = 'TermsNotAcceptedError'
  }
}

/** Raised on a 403 when the key's organization has been disabled. */
export class AccountUnavailableError extends TediError {
  constructor() {
    super('This account is unavailable.', {
      suggestions: ['Contact Tediware support if you believe this is in error.'],
    })
    this.name = 'AccountUnavailableError'
  }
}

/** Raised on a 404 for an unknown release/segment/element/transaction code. */
export class NotFoundError extends TediError {
  constructor(kind: string, code: string, release: string) {
    super(`No ${kind} '${code}' in release ${release}.`, {
      suggestions: [`Run \`tedi x12 releases\` to list releases, or double-check the ${kind} code.`],
      // The lookup ran and answered "there is no such thing" — a result, not a
      // failure to reach the platform, so it exits like a defect rather than 2.
      exitCode: EXIT_DEFECT,
    })
    this.name = 'NotFoundError'
  }
}

/**
 * Raised before an interchange is uploaded, when it exceeds the inspect
 * endpoint's size cap (see API.md). Checked client-side so an oversized file
 * fails at once instead of after a slow upload the server would reject anyway.
 *
 * Exits "could not run": the file was never examined, and its size says nothing
 * about whether it is valid.
 */
export class EdiTooLargeError extends TediError {
  constructor(bytes: number, limitBytes: number) {
    const kb = (n: number) => `${Math.ceil(n / 1024)} KB`
    super(`This interchange is ${kb(bytes)}; inspection accepts up to ${kb(limitBytes)}.`, {
      suggestions: ['Split the file so each interchange fits under the limit, or inspect a single transaction set.'],
    })
    this.name = 'EdiTooLargeError'
  }
}

/**
 * Raised on `unparseable_document`: the server took the file and could not read
 * it as EDI at all. This is the one inspection rejection that is a verdict on
 * the document, so it exits like a report full of errors rather than like a
 * broken tool.
 *
 * The server's message is safe to print — per the inspect contract it is a
 * rendered envelope diagnosis, never the raw parser error, which could quote
 * data from the file being inspected.
 */
export class UnreadableDocumentError extends TediError {
  constructor(serverMessage = '') {
    const message = serverMessage.trim()
    super(message || 'The server could not read this file as an X12 interchange.', {
      // The server's diagnosis is already actionable; only add a hint when it
      // told us nothing.
      suggestions: message ? [] : ['Check that the file is a complete X12 interchange (ISA … IEA).'],
      exitCode: EXIT_DEFECT,
    })
    this.name = 'UnreadableDocumentError'
  }
}

/**
 * Raised on `unsupported_release`: the document read fine, but the platform has
 * no reference data for the release named in its envelope. That is a gap on the
 * Tediware side, not a defect in the user's file, so it must not fail a build
 * the way findings do.
 */
export class UnsupportedReleaseError extends TediError {
  constructor(serverMessage = '') {
    const message = serverMessage.trim()
    super(message || 'The platform has no X12 reference data for the release in this interchange.', {
      suggestions: [
        'Run `tedi x12 releases` to see which releases the platform carries.',
        'Nothing was found wrong with the document: it simply was not validated, so treat this as inconclusive rather than as a failure.',
      ],
    })
    this.name = 'UnsupportedReleaseError'
  }
}

/**
 * Raised on `inspection_failed`: a fault on the server. Not a statement about
 * the document, so it exits "could not run" like a transport failure would.
 */
export class InspectionUnavailableError extends TediError {
  constructor(serverMessage = '') {
    const message = serverMessage.trim()
    super(message || 'The inspection failed on the Tediware side.', {
      suggestions: [
        'This is a fault on the server, not in your document. Retrying once is worth a try; if it persists, report it to Tediware support.',
      ],
    })
    this.name = 'InspectionUnavailableError'
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
        'Identity/whoami is deferred auth work (see API.md).',
        'To confirm a key actually authenticates, run `tedi x12 seg ISA` (a reference read that requires a valid key; `x12 releases` does not).',
      ],
    })
    this.name = 'IdentityUnavailableError'
  }
}
