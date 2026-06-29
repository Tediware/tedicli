/**
 * Thin client over the Tediware API.
 *
 * Per the brief, the CLI carries no proprietary logic and no licensed data: X12
 * reference rendering (including color and truncation) happens server-side, and
 * the client simply relays the requested format and returns what the server
 * renders. This module defines the client interface plus two implementations:
 *
 *   - `MockApiClient`   — canned, clearly-synthetic responses so the CLI is fully
 *                         runnable before the server endpoints exist. The mock data
 *                         here is invented for development and is NOT licensed X12
 *                         reference content.
 *   - `HttpApiClient`   — real HTTP client implementing the contract in `API.md`.
 *                         Reference and releases calls hit the platform; the
 *                         identity endpoint doesn't exist server-side yet and
 *                         throws a clear "not available yet" error.
 *
 * `createApiClient` selects between them. The mock is the default so a fresh
 * checkout works out of the box; set `TEDI_API_MOCK=0` to target a real server
 * (e.g. local `http://localhost:5004` via `tedi config set api.baseUrl`).
 */

import {OutputFormat} from './output.js'
import {
  AccountUnavailableError,
  IdentityUnavailableError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitedError,
  TediError,
  TermsNotAcceptedError,
} from './errors.js'
import {fetchWithTimeout} from './http.js'

export interface ReferenceRequest {
  release: string
  format: OutputFormat
  /** Whether to request server-side ANSI color (console format only). */
  color: boolean
}

/** A server-rendered reference document. `body` is ready to print as-is. */
export interface RenderedReference {
  release: string
  format: OutputFormat
  body: string
}

export interface ReleaseInfo {
  /** Release code, e.g. `004010`. This is what the CLI keys on, not the numeric id. */
  code: string
  /** Human-readable name, or null when the server hasn't set one. */
  name: string | null
  /** Whether this release is a HIPAA-designated version. */
  hipaa: boolean
}

export interface Identity {
  organization: string
  keyScope: string
  /** Last 4 characters of the API key, for display. */
  keyHint: string
}

export interface ApiClient {
  readonly isMock: boolean
  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Releases(): Promise<ReleaseInfo[]>
  whoami(): Promise<Identity>
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

// Newest first, mirroring the server's ordering. Synthetic development data.
const MOCK_RELEASES: ReleaseInfo[] = [
  {code: '006020', name: 'Release 006020', hipaa: false},
  {code: '005010', name: 'Release 005010', hipaa: true},
  {code: '004010', name: 'Release 004010', hipaa: false},
]

/**
 * Development-only mock. All content here is synthetic and exists purely to make
 * the CLI runnable; it is not real licensed X12 reference data.
 */
export class MockApiClient implements ApiClient {
  readonly isMock = true

  constructor(private readonly opts: ApiClientOptions) {}

  private requireToken(): void {
    if (!this.opts.token) throw new NotAuthenticatedError()
  }

  private render(kind: string, id: string, req: ReferenceRequest, lines: string[]): RenderedReference {
    const header =
      req.format === 'markdown'
        ? [`# ${kind} ${id}`, '', `> Release: ${req.release}`, '', '_(synthetic development data — not licensed X12 reference)_', '']
        : [`${kind} ${id}    [release ${req.release}]`, '']
    return {release: req.release, format: req.format, body: [...header, ...lines].join('\n')}
  }

  async x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    // Echo the id as received; case normalization is the command's job.
    return this.render('Segment', id, req, [
      'Purpose: (synthetic) example segment for development.',
      '',
      'Elements:',
      '  01  Reference Identification Qualifier   ID   M',
      '  02  Reference Identification             AN   O',
    ])
  }

  async x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render('Element', id, req, [
      'Name: (synthetic) Example Element',
      'Type: ID   Min/Max: 1/3',
      '',
      'Codes (synthetic; showing 3):',
      '  AA  Example value A',
      '  BB  Example value B',
      '  CC  Example value C',
    ])
  }

  async x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render('Transaction Set', id, req, [
      'Name: (synthetic) Example Transaction Set',
      '',
      'Loop structure:',
      '  Heading',
      '    ST  Transaction Set Header        M  1',
      '  Detail',
      '    HL  Hierarchical Level            M  >1',
      '  Summary',
      '    SE  Transaction Set Trailer       M  1',
    ])
  }

  async x12Releases(): Promise<ReleaseInfo[]> {
    return MOCK_RELEASES
  }

  async whoami(): Promise<Identity> {
    this.requireToken()
    return {organization: 'Acme EDI (dev)', keyScope: 'reference:read', keyHint: this.opts.token!.slice(-4)}
  }
}

// ---------------------------------------------------------------------------
// HTTP implementation (skeleton)
// ---------------------------------------------------------------------------

/** The reference resources and how they map to a path segment and a noun for errors. */
const REFERENCE_RESOURCES = {
  segment: 'segments',
  element: 'elements',
  transaction: 'transaction_sets',
} as const

type ReferenceKind = keyof typeof REFERENCE_RESOURCES

/** Shape of an entry in the `releases` response (`data.releases[]`). */
interface RawRelease {
  id: number
  code: string
  name: string | null
  hipaa: boolean
  published_at: string | null
}

/**
 * Real HTTP client, implementing the contract in `API.md`:
 *   - endpoints live under `<base>/api/x12`, no version prefix, all GET;
 *   - auth header is `Authorization: Key <api_key>`;
 *   - the release is part of the path, and the output format is the `variant` query;
 *   - errors are mapped from the HTTP status (see the error table in API.md).
 *
 * The identity (`whoami`) endpoint does not exist yet, so that method throws a
 * clear "not available yet" error (see API.md "Not available yet"). Keys are
 * obtained out of band and provided via `tedi auth login` or `TEDI_API_KEY`.
 */
export class HttpApiClient implements ApiClient {
  readonly isMock = false

  constructor(private readonly opts: ApiClientOptions) {}

  private get base(): string {
    return this.opts.baseUrl.replace(/\/$/, '')
  }

  /** API.md: every request authenticates with `Authorization: Key <api_key>`. */
  private authHeaders(): Record<string, string> {
    return this.opts.token ? {authorization: `Key ${this.opts.token}`} : {}
  }

  /** Best-effort extraction of the server's error message (string or `{code,message}`). */
  private async readErrorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as {error?: unknown}
      const err = body?.error
      if (typeof err === 'string') return err
      if (err && typeof err === 'object' && typeof (err as {message?: unknown}).message === 'string') {
        return (err as {message: string}).message
      }
    } catch {
      // Non-JSON or empty body; fall through to a generic message.
    }
    return ''
  }

  /**
   * Map a non-2xx response to an actionable error, branching on the status code
   * (per API.md, the 429 body shape differs, so never branch on the body). `ctx`
   * supplies the resource for a contextual 404 message.
   */
  private async throwForStatus(res: Response, ctx?: {kind: ReferenceKind; code: string; release: string}): Promise<never> {
    switch (res.status) {
      case 401:
        throw new NotAuthenticatedError()
      case 403: {
        const msg = await this.readErrorMessage(res)
        // Two distinct 403s: unaccepted service terms vs. a disabled organization.
        if (/terms/i.test(msg)) throw new TermsNotAcceptedError()
        throw new AccountUnavailableError()
      }
      case 404:
        if (ctx) throw new NotFoundError(ctx.kind, ctx.code, ctx.release)
        throw new TediError('Record not found.')
      case 429: {
        const header = res.headers.get('retry-after')
        const retry = header === null ? undefined : Number(header)
        throw new RateLimitedError(Number.isFinite(retry) ? retry : undefined)
      }
      default: {
        const msg = await this.readErrorMessage(res)
        const detail = msg ? `: ${msg}` : ''
        throw new TediError(`Tediware API request failed (${res.status} ${res.statusText})${detail}.`)
      }
    }
  }

  private async reference(kind: ReferenceKind, code: string, req: ReferenceRequest): Promise<RenderedReference> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const resource = REFERENCE_RESOURCES[kind]
    const url = new URL(
      `${this.base}/api/x12/${encodeURIComponent(req.release)}/${resource}/${encodeURIComponent(code)}/download`,
    )
    // The CLI always sends an explicit variant (the server would otherwise default
    // to markdown). `color` is only meaningful for the console variant.
    url.searchParams.set('variant', req.format)
    if (req.color) url.searchParams.set('color', 'true')

    const res = await fetchWithTimeout(url, {headers: this.authHeaders()})
    if (!res.ok) await this.throwForStatus(res, {kind, code, release: req.release})

    const body = await res.text()
    return {release: req.release, format: req.format, body}
  }

  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference('segment', id, req)
  }

  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference('element', id, req)
  }

  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference('transaction', id, req)
  }

  async x12Releases(): Promise<ReleaseInfo[]> {
    // `releases` is reachable without a key, but API.md asks us to send the header
    // anyway so usage counts against the per-key limit rather than only the per-IP one.
    const res = await fetchWithTimeout(`${this.base}/api/x12/releases`, {headers: this.authHeaders()})
    if (!res.ok) await this.throwForStatus(res)
    const payload = (await res.json()) as {data?: {releases?: RawRelease[]}}
    return (payload.data?.releases ?? []).map((r) => ({
      code: r.code,
      name: r.name ?? null,
      hipaa: Boolean(r.hipaa),
    }))
  }

  async whoami(): Promise<Identity> {
    // The identity endpoint doesn't exist server-side yet (API.md). Throw a typed
    // error so the whoami/auth-status commands can degrade gracefully.
    throw new IdentityUnavailableError()
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Whether the mock client should be used. Mock is still the default so a fresh
 * checkout (and the test suite) runs without a live server or a real API key.
 * Disable it with any common falsy value — `TEDI_API_MOCK=0`, `false`, `no`,
 * `off` — to hit the real API described in `API.md`. (Flipping this default to
 * HTTP is a release decision: it needs the auth/identity endpoints, which aren't
 * built yet, and a configured key.)
 */
export function useMock(): boolean {
  const value = (process.env.TEDI_API_MOCK ?? '').trim().toLowerCase()
  if (value === '') return true
  return !['0', 'false', 'no', 'off'].includes(value)
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return useMock() ? new MockApiClient(opts) : new HttpApiClient(opts)
}
