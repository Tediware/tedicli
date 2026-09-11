/**
 * Error types shared across commands. These carry a user-facing message plus an
 * optional `suggestions` list that the base command renders as oclif help text,
 * and an optional machine `code` (the server's, when the failure was the
 * server's refusal) that `--json` carries through.
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

/** Where an API key is minted, relative to the configured server. */
export function apiKeysUrl(baseUrl?: string): string {
  return `${(baseUrl ?? 'https://tediware.com').replace(/\/$/, '')}/app/api-keys`
}

export class TediError extends Error {
  readonly suggestions: string[]
  readonly exitCode: number
  /** The server's stable machine code, when the failure was its refusal. */
  readonly code?: string

  constructor(message: string, opts: {suggestions?: string[]; exitCode?: number; code?: string} = {}) {
    super(message)
    this.name = 'TediError'
    this.suggestions = opts.suggestions ?? []
    // Default to "could not run". An unclassified failure has, by definition,
    // not established anything about the user's document, and mislabeling one as
    // a defect is the more damaging direction of the two.
    this.exitCode = opts.exitCode ?? EXIT_UNUSABLE
    if (opts.code !== undefined) this.code = opts.code
  }
}

/** Raised when a command needs credentials but none are stored. */
export class NotAuthenticatedError extends TediError {
  constructor(baseUrl?: string) {
    super('You are not signed in.', {
      suggestions: [`Get a key at ${apiKeysUrl(baseUrl)} then run \`tedi auth login\` to authenticate with Tediware.`],
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
          ? `Check that api.baseUrl is the server that issued the key. It is currently ${baseUrl} (\`tedi config get api.baseUrl\`).`
          : 'Check that api.baseUrl points at the server that issued the key (`tedi config get api.baseUrl`).',
        'If the URL is correct, the key may be wrong or revoked. Re-run `tedi auth login`, or check TEDI_API_KEY if it is set.',
      ],
    })
    this.name = 'InvalidApiKeyError'
  }
}

/**
 * The one wording for "this command has no `--json`". Each caller says what the
 * output is instead and what to do with it; the lead-in never varies, so the
 * refusal reads the same on every command that carries it.
 */
export class JsonNotOfferedError extends TediError {
  constructor(reason: string, suggestions: string[]) {
    super(`--json is not offered here: ${reason}`, {suggestions})
    this.name = 'JsonNotOfferedError'
  }
}

/** Raised when the user requests `--json` for licensed X12 reference data. */
export class JsonNotSupportedError extends JsonNotOfferedError {
  constructor() {
    super('licensed X12 reference data is presentation-only.', [
      'X12 reference is available as `--format console` (the default) or `--format markdown`.',
    ])
    this.name = 'JsonNotSupportedError'
  }
}

/** Raised when the server rejects a request because service terms are not accepted. */
export class TermsNotAcceptedError extends TediError {
  constructor(baseUrl?: string) {
    super('Your account has not accepted the current Tediware service terms.', {
      suggestions: [
        `Accept the terms in the dashboard at ${apiKeysUrl(baseUrl)}, then run \`tedi whoami\` to confirm.`,
      ],
      code: 'service_terms_required',
    })
    this.name = 'TermsNotAcceptedError'
  }
}

/** Raised on a 403 when the key's organization has been disabled. */
export class AccountUnavailableError extends TediError {
  constructor() {
    super('This account is unavailable.', {
      suggestions: ['Contact Tediware support if you believe this is in error.'],
      code: 'organization_disabled',
    })
    this.name = 'AccountUnavailableError'
  }
}

/** Raised on a 404 for an unknown segment/element/transaction-set code. */
export class NotFoundError extends TediError {
  constructor(kind: string, code: string, release: string) {
    super(`No ${kind} '${code}' in release ${release}.`, {
      suggestions: [`Double-check the ${kind} code, or run \`tedi x12 releases\` to list releases.`],
      // The lookup ran and answered "there is no such thing": a result, not a
      // failure to reach the platform, so it exits like a defect rather than 2.
      exitCode: EXIT_DEFECT,
      code: 'not_found',
    })
    this.name = 'NotFoundError'
  }
}

/** Raised on a 404 whose code says the release itself is not on this server. */
export class UnknownReleaseError extends TediError {
  constructor(release: string, serverMessage = '') {
    super(serverMessage.trim() || `This server does not carry X12 release ${release}.`, {
      suggestions: ['Run `tedi x12 releases` to list the releases the platform carries.'],
      // Not a verdict on the code looked up: the lookup never reached a release.
      exitCode: EXIT_UNUSABLE,
      code: 'unknown_release',
    })
    this.name = 'UnknownReleaseError'
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
 * The server's message is safe to print. Per the inspect contract it is a
 * rendered envelope diagnosis, never the raw parser error, which could quote
 * data from the file being inspected.
 */
export class UnreadableDocumentError extends TediError {
  constructor(serverMessage = '') {
    const message = serverMessage.trim()
    super(message || 'The server could not read this file as an X12 interchange.', {
      // The server's diagnosis is already actionable; only add a hint when it
      // told us nothing.
      suggestions: message ? [] : ['Check that the file is a complete X12 interchange (ISA through IEA).'],
      exitCode: EXIT_DEFECT,
      code: 'unparseable_document',
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
      code: 'unsupported_release',
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
      code: 'inspection_failed',
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
    // can't see the counters, only the 429 and the Retry-After hint.
    super(`Rate limit exceeded.${wait}`, {
      suggestions: ["You're sending requests too quickly; wait a moment before retrying."],
      code: 'rate_limited',
    })
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Raised when the server has no identity endpoint (a JSON 404 on
 * /platform/whoami, from a server older than the endpoint). Commands catch
 * this to degrade gracefully rather than failing: the CLI still knows a key is
 * stored locally.
 */
export class IdentityUnavailableError extends TediError {
  constructor() {
    super('This server has no identity endpoint.', {
      suggestions: ['The server at api.baseUrl predates `whoami`. Check `tedi config get api.baseUrl`.'],
      code: 'no_route',
    })
    this.name = 'IdentityUnavailableError'
  }
}

/**
 * Raised when a 404 carries no error code the plane recognizes: the route is
 * not there, which almost always means api.baseUrl is wrong (a path on it, or a
 * server too old to know the endpoint). Never a verdict about a record.
 */
export class NoSuchEndpointError extends TediError {
  constructor(baseUrl: string) {
    super(`No such endpoint at ${baseUrl}.`, {
      suggestions: [
        'Check api.baseUrl (`tedi config get api.baseUrl`): it should be the scheme and host only, with no path.',
        'If it is right, the server may be older than this command.',
      ],
      code: 'no_route',
    })
    this.name = 'NoSuchEndpointError'
  }
}

/**
 * Raised when a data-plane lookup by id answers 404: the platform ran the query
 * and there is no such record in the caller's organization. A result, not a
 * failure to reach the platform, so it exits like a defect (matching
 * NotFoundError on the reference plane).
 */
export class DataNotFoundError extends TediError {
  constructor(kind: string, id: string) {
    super(`No ${kind} '${id}' in your organization.`, {
      suggestions:
        kind === 'partner'
          ? ['Run `tedi partner list` to see the partner keys in your organization.']
          : ['Check the id for a copy-paste slip; ids appear in list output and transaction detail.'],
      exitCode: EXIT_DEFECT,
      code: 'not_found',
    })
    this.name = 'DataNotFoundError'
  }
}

/**
 * Raised when the server answered a 2xx with something other than JSON. Almost
 * always a wrong api.baseUrl: a login page, a proxy, a static host.
 */
export class NotJsonError extends TediError {
  constructor(baseUrl: string, contentType: string | null) {
    super(`The server at ${baseUrl} did not answer with JSON (${contentType || 'no content-type'}).`, {
      suggestions: ['Check api.baseUrl (`tedi config get api.baseUrl`): it should name a Tediware server.'],
    })
    this.name = 'NotJsonError'
  }
}

/**
 * Raised when the server's 2xx JSON lacks a field the contract promises.
 * Defaulting the field would make a stale or foreign server look healthy, which
 * is the wrong direction for an identity check to be wrong in.
 */
export class ContractViolationError extends TediError {
  constructor(what: string, baseUrl: string) {
    super(`The server at ${baseUrl} answered without ${what}.`, {
      suggestions: [
        'Check api.baseUrl (`tedi config get api.baseUrl`): it should name a current Tediware server.',
        'If it does, run `tedi update`; this build and the server disagree about the response shape.',
      ],
    })
    this.name = 'ContractViolationError'
  }
}

/** The reason a filesystem call failed, in words a user can act on. */
export function describeFsCode(code: string | undefined): string {
  switch (code) {
    case 'ENOENT':
      return 'no such file or directory'
    case 'EACCES':
    case 'EPERM':
      return 'permission denied'
    case 'EISDIR':
      return 'it is a directory'
    case 'ENOTDIR':
      return 'a component of the path is not a directory'
    case 'EEXIST':
      return 'a component of the path already exists and is not a directory'
    case 'ENOSPC':
      return 'no space left on device'
    case 'EROFS':
      return 'the filesystem is read-only'
    default:
      return code ? code : 'unknown error'
  }
}

/**
 * A filesystem failure as a TediError naming the path the user asked for and
 * the reason. The atomic writer's temp path never appears: the user asked for
 * the target, so the target is what the message names.
 */
export class FileAccessError extends TediError {
  readonly fsCode?: string

  constructor(verb: 'read' | 'write', path: string, err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    super(`Cannot ${verb} ${path}: ${describeFsCode(code)}.`, {
      suggestions:
        code === 'ENOENT' && verb === 'read'
          ? ['Check the path for a typo; relative paths resolve against the current directory.']
          : code === 'EACCES' || code === 'EPERM'
            ? ['Check the permissions on the path and its parent directories.']
            : [],
    })
    this.name = 'FileAccessError'
    if (code !== undefined) this.fsCode = code
  }
}
