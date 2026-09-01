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
 *   - `HttpApiClient`   — real HTTP client implementing the contract in `API.md`,
 *                         covering the X12 reference reads, EDI inspection, and
 *                         the platform data plane (`/platform/...`).
 *
 * `createApiClient` selects between them. The real HTTP client is the default so
 * a published CLI talks to the actual platform; set `TEDI_API_MOCK=1` to opt into
 * the mock for development or tests (no live server or real key required).
 */

import {OutputFormat} from './output.js'
import {
  AccountUnavailableError,
  DataNotFoundError,
  EdiTooLargeError,
  EXIT_DEFECT,
  IdentityUnavailableError,
  InspectionUnavailableError,
  InvalidApiKeyError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitedError,
  TediError,
  TermsNotAcceptedError,
  UnreadableDocumentError,
  UnsupportedReleaseError,
} from './errors.js'
import {fetchWithTimeout, FetchOptions} from './http.js'
import {
  applyQuery,
  ArtifactContent,
  FeedEntry,
  FeedQuery,
  LogLine,
  LogQuery,
  Page,
  PartnerReceiveReceipt,
  PartnerSendReceipt,
  PlatformResult,
  ResultListQuery,
  TransactionDetail,
  TransactionListQuery,
  TransactionSummary,
} from './platform.js'

/**
 * How many element codes to render: a positive count, or `'all'` for the whole
 * list. Undefined leaves the choice to the server's own default (20 today).
 */
export type CodeLimit = number | 'all'

export interface ReferenceRequest {
  release: string
  format: OutputFormat
  /** Whether to request server-side ANSI color (console format only). */
  color: boolean
  /**
   * Cap on the rendered element code list. Only the `console` variant truncates,
   * so this does nothing for `markdown`, and the segment and transaction-set
   * endpoints accept and ignore it.
   */
  codeLimit?: CodeLimit
}

/** A server-rendered reference document. `body` is ready to print as-is. */
export interface RenderedReference {
  release: string
  format: OutputFormat
  body: string
}

/**
 * An inspection request. Unlike a reference lookup this is not release-scoped:
 * the release comes from the interchange's own envelope, so the server resolves
 * it (and rejects unsupported ones) from the document itself.
 */
export interface InspectionRequest {
  format: OutputFormat
  /** Whether to request server-side ANSI color (console format only). */
  color: boolean
}

/**
 * What the inspection found, as reported by the response headers rather than by
 * re-reading the rendered report (which is the server's to format).
 */
export interface InspectionFindings {
  errors: number
  notices: number
  /**
   * Whether every check actually ran. The inspection is deliberately fail-soft:
   * a check that crashes takes its findings with it, so a document nobody
   * examined can come back with zero errors. `false` means the report is not
   * evidence of anything, which is why a gate on the counts alone is wrong.
   */
  complete: boolean
}

/** A server-rendered inspection report. `body` is ready to print as-is. */
export interface InspectedEdi {
  format: OutputFormat
  body: string
  /**
   * The findings summary from the response headers, or `undefined` when the
   * server did not send it. Undefined is *not* zero: it means this run learned
   * nothing about how the document fared, and callers must not report a clean
   * bill of health on the strength of it.
   */
  findings?: InspectionFindings
}

export interface ReleaseInfo {
  /** Release code, e.g. `004010`. This is what the CLI keys on, not the numeric id. */
  code: string
  /** Human-readable name, or null when the server hasn't set one. */
  name: string | null
  /** Whether this release is a HIPAA-designated version. */
  hipaa: boolean
}

/** The principal behind the key, from `GET /platform/whoami`. */
export interface Identity {
  organization: string
  organizationId: string
  keyScope: string
  /** The key's label as named in the dashboard, or null for an unnamed key. */
  keyLabel: string | null
  /** Whether the key's creator has accepted the current service terms. */
  termsAccepted: boolean
  /** Last 4 characters of the API key, for display. Derived locally. */
  keyHint: string
}

export interface ApiClient {
  readonly isMock: boolean
  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Releases(): Promise<ReleaseInfo[]>
  ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi>
  whoami(): Promise<Identity>
  transactionList(query: TransactionListQuery): Promise<Page<TransactionSummary>>
  transactionGet(id: string): Promise<TransactionDetail>
  transactionResend(id: string): Promise<{ediTransactionId: string}>
  resultList(query: ResultListQuery): Promise<Page<PlatformResult>>
  resultGet(id: string): Promise<PlatformResult>
  logList(query: LogQuery): Promise<Page<LogLine>>
  feedList(query: FeedQuery): Promise<Page<FeedEntry>>
  artifactGet(id: string): Promise<ArtifactContent>
  partnerSend(key: string, code: string, contents: unknown, filename?: string): Promise<PartnerSendReceipt>
  partnerReceive(key: string, contents: string, filename?: string): Promise<PartnerReceiveReceipt>
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
}

/** Largest interchange the inspect endpoint accepts (API.md). */
export const MAX_INSPECT_BYTES = 256 * 1024

/**
 * Reject an oversized document before it goes over the wire. Both backends call
 * it so they behave the same, and the limit lives next to the contract that sets
 * it. Exported so a command can also fail fast, before spending work on a
 * document that was never going to be accepted.
 */
export function assertInspectableSize(content: string): void {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_INSPECT_BYTES) throw new EdiTooLargeError(bytes, MAX_INSPECT_BYTES)
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

/** Synthetic code list, long enough that the mock can actually truncate it. */
const MOCK_ELEMENT_CODES: ReadonlyArray<readonly [string, string]> = [
  ['AA', 'Example value A'],
  ['BB', 'Example value B'],
  ['CC', 'Example value C'],
  ['DD', 'Example value D'],
  ['EE', 'Example value E'],
]

/** The mock's stand-in for the server's default console truncation. */
const MOCK_DEFAULT_CODE_PREVIEW = 3

function mockCodeCap(limit: CodeLimit | undefined, total: number): number {
  if (limit === 'all') return total
  return limit ?? MOCK_DEFAULT_CODE_PREVIEW
}

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
    // Imitate the server's truncation so the `--limit`/`--all` plumbing is
    // exercisable against the mock; the codes themselves remain synthetic.
    const codes = MOCK_ELEMENT_CODES
    const cap = req.format === 'markdown' ? codes.length : mockCodeCap(req.codeLimit, codes.length)
    const shown = codes.slice(0, cap)
    const footer =
      shown.length < codes.length
        ? ['', `(${codes.length} codes; showing ${shown.length}. Use --all for the full list.)`]
        : []
    return this.render('Element', id, req, [
      'Name: (synthetic) Example Element',
      'Type: ID   Min/Max: 1/3',
      '',
      `Codes (synthetic; ${shown.length} of ${codes.length}):`,
      ...shown.map(([code, name]) => `  ${code}  ${name}`),
      ...footer,
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

  async ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi> {
    this.requireToken()
    assertInspectableSize(content)
    // The mock does not parse EDI — it counts segments crudely so a developer can
    // still see the command's plumbing (and the effect of --obfuscate) end to end.
    const segments = content
      .split(/[~\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const first = /^[A-Za-z0-9]+/.exec(segments[0] ?? '')?.[0]?.toUpperCase() ?? '(none)'
    const header =
      req.format === 'markdown'
        ? ['# EDI inspection', '', '_(synthetic development data — the mock backend does not parse EDI)_', '']
        : ['EDI inspection    [mock]', '']
    return {
      format: req.format,
      body: [
        ...header,
        `Segments: ${segments.length}`,
        `First segment: ${first}`,
        '',
        'Findings: none (synthetic — no parsing or validation happened).',
      ].join('\n'),
      // Reported as a clean, complete run so the command's exit-code path is
      // exercisable against the mock. The body says plainly that nothing was
      // actually validated; no real document is being vouched for here.
      findings: {errors: 0, notices: 0, complete: true},
    }
  }

  async whoami(): Promise<Identity> {
    this.requireToken()
    return {
      organization: 'Acme EDI (dev)',
      organizationId: 'mock-org-0000',
      keyScope: 'standard',
      keyLabel: 'Development key',
      termsAccepted: true,
      keyHint: this.opts.token!.slice(-4),
    }
  }

  async transactionList(query: TransactionListQuery): Promise<Page<TransactionSummary>> {
    this.requireToken()
    let rows = MOCK_TRANSACTIONS
    if (query.incoming !== undefined) rows = rows.filter((t) => t.incoming === query.incoming)
    if (query.transactionSetIdentifier) {
      rows = rows.filter((t) => t.transactionSetIdentifier === query.transactionSetIdentifier)
    }

    if (query.trace) rows = rows.filter((t) => t.traceGuid === query.trace)
    return {items: rows.slice(0, query.limit ?? 50), hasMore: false, nextCursor: null}
  }

  async transactionGet(id: string): Promise<TransactionDetail> {
    this.requireToken()
    const row = MOCK_TRANSACTIONS.find((t) => t.id === id)
    if (!row) throw new DataNotFoundError('transaction', id)
    return {...row, status: 'delivered', flowName: 'Mock Inbound Flow', results: MOCK_RESULTS}
  }

  async transactionResend(id: string): Promise<{ediTransactionId: string}> {
    this.requireToken()
    if (!MOCK_TRANSACTIONS.some((t) => t.id === id)) throw new DataNotFoundError('transaction', id)
    return {ediTransactionId: id}
  }

  async resultList(query: ResultListQuery): Promise<Page<PlatformResult>> {
    this.requireToken()
    let rows = MOCK_RESULTS
    if (query.trace) rows = rows.filter((r) => r.traceGuid === query.trace)
    return {items: rows.slice(0, query.limit ?? 50), hasMore: false, nextCursor: null}
  }

  async resultGet(id: string): Promise<PlatformResult> {
    this.requireToken()
    const row = MOCK_RESULTS.find((r) => r.id === id)
    if (!row) throw new DataNotFoundError('result', id)
    return row
  }

  async logList(query: LogQuery): Promise<Page<LogLine>> {
    this.requireToken()
    let rows = MOCK_LOGS.filter((l) => l.traceGuid === query.trace)
    if (query.level) rows = rows.filter((l) => l.level === query.level)
    return {items: rows.slice(0, query.limit ?? 50), hasMore: false, nextCursor: null}
  }

  async feedList(query: FeedQuery): Promise<Page<FeedEntry>> {
    this.requireToken()
    let rows = MOCK_FEED
    if (query.direction) rows = rows.filter((f) => f.direction === query.direction)
    if (query.status) rows = rows.filter((f) => f.status === query.status)
    // An empty page echoes the cursor, matching the server's tail contract.
    if (query.cursor) return {items: [], hasMore: false, nextCursor: query.cursor}
    return {items: rows.slice(0, query.limit ?? 50), hasMore: false, nextCursor: 'mock-cursor-1'}
  }

  async artifactGet(id: string): Promise<ArtifactContent> {
    this.requireToken()
    if (!MOCK_RESULTS.some((r) => r.detail.artifacts?.some((a) => a.id === id))) {
      throw new DataNotFoundError('artifact', id)
    }

    return {
      bytes: new TextEncoder().encode('ISA*00*(synthetic development artifact — not real EDI)~'),
      contentType: 'application/edi-x12',
      filename: 'mock.edi',
    }
  }

  async partnerSend(): Promise<PartnerSendReceipt> {
    this.requireToken()
    return {
      interchangeControlNumber: '000000001',
      groupControlNumber: '000000001',
      traceGuid: 'mock-trace-outbound',
    }
  }

  async partnerReceive(): Promise<PartnerReceiveReceipt> {
    this.requireToken()
    return {traceGuid: 'mock-trace-inbound'}
  }
}

// Synthetic development data for the platform surface: fixed ids so tests and
// manual exploration can address records without a discovery step.
const MOCK_TRACE = 'aaaaaaaa-0000-0000-0000-000000000001'

const MOCK_TRANSACTIONS: TransactionSummary[] = [
  {
    id: 'mock-txn-1',
    senderExtid: 'SENDERID',
    senderQualifier: 'ZZ',
    receiverExtid: 'RECEIVERID',
    receiverQualifier: 'ZZ',
    interchangeControlNumber: '000000001',
    groupControlNumber: '000000001',
    transactionSetControlNumber: '0001',
    transactionSetIdentifier: '850',
    traceGuid: MOCK_TRACE,
    incoming: true,
    acknowledgmentStatus: undefined,
    resendCount: 0,
    lastResentAt: null,
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:00Z',
  },
  {
    id: 'mock-txn-2',
    senderExtid: 'RECEIVERID',
    senderQualifier: 'ZZ',
    receiverExtid: 'SENDERID',
    receiverQualifier: 'ZZ',
    interchangeControlNumber: '000000002',
    groupControlNumber: '000000002',
    transactionSetControlNumber: '0001',
    transactionSetIdentifier: '856',
    traceGuid: 'aaaaaaaa-0000-0000-0000-000000000002',
    incoming: false,
    acknowledgmentStatus: 'accepted',
    resendCount: 0,
    lastResentAt: null,
    createdAt: '2026-01-02T12:00:00Z',
    updatedAt: '2026-01-02T12:00:00Z',
  },
]

const MOCK_RESULTS: PlatformResult[] = [
  {
    id: 'mock-result-1',
    traceGuid: MOCK_TRACE,
    nodeName: 'EDI Endpoint',
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:01Z',
    detail: {
      direction: 'inbound',
      artifacts: [
        {id: 'mock-artifact-1', usage: 'edi', contentType: 'application/edi-x12', filename: 'in.edi'},
      ],
      transformations: ['EDI Endpoint', 'EDI to JSON'],
    },
  },
]

const MOCK_LOGS: LogLine[] = [
  {
    id: 'mock-log-1',
    level: 'info',
    message: '(synthetic) Received document',
    nodeName: 'EDI Endpoint',
    traceGuid: MOCK_TRACE,
    createdAt: '2026-01-01T12:00:00Z',
  },
  {
    id: 'mock-log-2',
    level: 'info',
    message: '(synthetic) Delivered to webhook',
    nodeName: 'Webhook',
    traceGuid: MOCK_TRACE,
    createdAt: '2026-01-01T12:00:01Z',
  },
]

const MOCK_FEED: FeedEntry[] = [
  {
    id: 'mock-feed-1',
    direction: 'inbound',
    status: 'success',
    partnerKey: 'ACME',
    traceGuid: MOCK_TRACE,
    resultId: 'mock-result-1',
    createdAt: '2026-01-01T12:00:01Z',
    detail: {
      direction: 'inbound',
      artifacts: [
        {id: 'mock-artifact-1', usage: 'edi', contentType: 'application/edi-x12', filename: 'in.edi'},
      ],
    },
  },
]

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

/**
 * A refusal, as the server states it: a human message plus a stable machine
 * `code` (absent on the auth and throttle responses, and on any server old
 * enough to predate the codes).
 */
export interface ServerFault {
  message: string
  code?: string
  status: number
}

/**
 * The server's message as a trailing clause, or nothing when it sent none.
 *
 * Every caller closes the sentence with its own period, and the server's
 * messages are themselves sentences ("Invalid limit '0'. Use a positive integer
 * or 'all'."), so the two meet as `...or 'all'..`. Drop the borrowed one.
 */
function detailOf(fault: ServerFault): string {
  return fault.message ? `: ${fault.message.replace(/\s*\.\s*$/, '')}` : ''
}

/** Per-request hooks that let one status mapper word errors for each endpoint. */
interface ErrorContext {
  /** Lookup being performed, used to word a contextual 404. */
  reference?: {kind: ReferenceKind; code: string; release: string}
  /** Builds the error for a rejected request from the server's own account of it. */
  rejected?: (fault: ServerFault) => TediError
  /** Builds the 404 for endpoints where a miss means the route itself is absent. */
  missing?: () => TediError
  /**
   * Data-plane lookup by id. A 404 here is ambiguous: a genuine miss carries
   * `code: "not_found"` in the body, while a server too old to have the route
   * answers a code-less routing 404 — and only the first is a verdict the CLI
   * may assert (exit 1). The second must not tell CI the record does not exist.
   */
  notFound?: {kind: string; id: string}
}

/**
 * Inspection parses (and validates) a whole document, so it can legitimately
 * take longer than a reference read. Give it a longer leash than the shared
 * default rather than timing out a large but perfectly good file.
 */
const INSPECT_TIMEOUT_MS = 60_000

/** Response headers a 200 from `/api/edi/inspect` carries its findings summary in. */
const FINDINGS_ERRORS_HEADER = 'x-edi-findings-errors'
const FINDINGS_NOTICES_HEADER = 'x-edi-findings-notices'
const INSPECTION_COMPLETE_HEADER = 'x-edi-inspection-complete'

/**
 * Parse a count header; undefined when it is absent or not a plain count.
 *
 * Deliberately stricter than `Number()`, which would take `3.0`, `1e2`, `0x10`
 * and a repeated header's `"3, 3"` as counts. None of those are things this
 * server sends, so reading one as a number means guessing at a response we do
 * not understand — and the whole point here is to say "unknown" instead.
 */
function readCount(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined
  return Number(raw.trim())
}

/**
 * Read the findings summary out of a 200's headers.
 *
 * Undefined unless all three headers are present and make sense: a partial or
 * garbled set means "we don't know how this document fared", never "nothing was
 * wrong with it". `complete` is true only when the server says exactly that, so
 * an unrecognized value degrades to the cautious reading rather than the
 * flattering one.
 */
function readFindings(headers: Headers): InspectionFindings | undefined {
  const errors = readCount(headers.get(FINDINGS_ERRORS_HEADER))
  const notices = readCount(headers.get(FINDINGS_NOTICES_HEADER))
  const complete = headers.get(INSPECTION_COMPLETE_HEADER)
  if (errors === undefined || notices === undefined || complete === null) return undefined
  return {errors, notices, complete: complete.trim().toLowerCase() === 'true'}
}

/**
 * Turn a rejected inspection into the right error.
 *
 * The `code` decides this, not the status. The statuses have moved once already
 * — missing and non-string content answered 422 before they answered 400, and an
 * oversize body now answers 413 — while the codes are the stable half of the
 * contract. The status is only a fallback for a response that carries no code.
 *
 * What is being decided is whose fault the refusal is. Only
 * `unparseable_document` says anything about the user's file; an unsupported
 * release is a gap in Tediware's reference data and `inspection_failed` is a bug
 * on the server, so neither may fail a build the way findings do.
 */
function inspectionRefusal(fault: ServerFault): TediError {
  const detail = detailOf(fault)
  switch (fault.code) {
    case 'unparseable_document':
      return new UnreadableDocumentError(fault.message)
    case 'unsupported_release':
      return new UnsupportedReleaseError(fault.message)
    case 'inspection_failed':
      return new InspectionUnavailableError(fault.message)
    case 'content_too_large':
      // The CLI refuses oversized documents before uploading, so getting this
      // back means the server's cap is now lower than the one this build knows.
      return new TediError(fault.message || 'The server rejected this interchange as too large.', {
        suggestions: [
          `This build refuses anything over ${MAX_INSPECT_BYTES / 1024} KB before uploading, so the server's limit has moved — run \`tedi update\` for a build that knows the current one.`,
        ],
      })
    case 'invalid_parameter':
    case 'invalid_variant':
    case 'missing_parameter':
      // The CLI builds every part of this request bar the document itself.
      return new TediError(`The Tediware API rejected this request (${fault.code})${detail}.`, {
        suggestions: [
          'This is a fault in the CLI rather than in your document — run `tedi update`, and report it if a current version still fails.',
        ],
      })
    default:
      // No code, or one this build has not heard of. A 422 has always meant the
      // document could not be read; anything else is not about the document.
      if (fault.status === 422) return new UnreadableDocumentError(fault.message)
      return new TediError(`The Tediware API refused this inspection (HTTP ${fault.status})${detail}.`)
  }
}

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
 * Data-plane endpoints live under `<base>/platform` on the same credential and
 * answer camelCase JSON with the nested `{error: {message, code, reason?}}`
 * refusal body, which `readFault` already reads. Keys are obtained out of band
 * and provided via `tedi auth login` or `TEDI_API_KEY`.
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

  /**
   * `fetchWithTimeout`, with an unreachable server turned into something the
   * user can act on.
   *
   * Left alone, a DNS miss, a refused connection, or a stalled request escapes
   * as a raw `TypeError: fetch failed`. That is not a `TediError`, so it reaches
   * the user as a stack trace and oclif exits 1 for it — telling a CI job the
   * document is bad when the CLI never got as far as asking about it. The whole
   * point of the 1/2 split is to not say that.
   */
  private async send(url: string | URL, opts: FetchOptions = {}): Promise<Response> {
    try {
      return await fetchWithTimeout(url, opts)
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      const whereToLook = `Confirm api.baseUrl points where you expect — currently ${this.base} (\`tedi config get api.baseUrl\`).`
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new TediError(`The Tediware API at ${this.base} did not respond in time.`, {
          suggestions: ['The server may be busy or unreachable; try again in a moment.', whereToLook],
        })
      }
      // Node hides the useful part (ECONNREFUSED, ENOTFOUND) in `cause`.
      const code = (err as {cause?: {code?: unknown}} | undefined)?.cause?.code
      throw new TediError(
        `Could not reach the Tediware API at ${this.base}${typeof code === 'string' ? ` (${code})` : ''}.`,
        {suggestions: ['Check your network connection, and any proxy or VPN in the way.', whereToLook]},
      )
    }
  }

  /**
   * Best-effort read of the server's account of a refusal.
   *
   * Two body shapes are in play (API.md): the flat `{error, code}` the
   * controllers return, and the platform throttle envelope, where `error` is
   * itself an object carrying `message` and `code`. Both are read here so the
   * caller never has to care which one it got.
   */
  private async readFault(res: Response): Promise<ServerFault> {
    const fault: ServerFault = {message: '', status: res.status}
    try {
      const body = (await res.json()) as {error?: unknown; code?: unknown}
      const err = body?.error
      if (typeof err === 'string') fault.message = err
      else if (err && typeof err === 'object') {
        const nested = err as {message?: unknown; code?: unknown}
        if (typeof nested.message === 'string') fault.message = nested.message
        if (typeof nested.code === 'string') fault.code = nested.code
      }
      if (typeof body?.code === 'string') fault.code = body.code
    } catch {
      // Non-JSON or empty body; the caller falls back to a generic message.
    }
    return fault
  }

  /** Best-effort extraction of just the server's error message. */
  private async readErrorMessage(res: Response): Promise<string> {
    return (await this.readFault(res)).message
  }

  /**
   * Map a non-2xx response to an actionable error, branching on the status code
   * (per API.md, the 429 body shape differs, so never branch on the body).
   */
  private async throwForStatus(res: Response, ctx: ErrorContext = {}): Promise<never> {
    switch (res.status) {
      case 400:
      case 413:
      case 422: {
        // Request-shaped failures. Only `inspect` can legitimately produce one,
        // since its payload is the user's file; it reads the `code` to work out
        // whose fault the refusal is. For reference lookups the CLI builds every
        // parameter and validates `--limit` before sending, so one of these is a
        // bug — but `invalid_limit` is at least traceable to something the user
        // typed, so name it instead of printing a bare status.
        const fault = await this.readFault(res)
        if (ctx.rejected) throw ctx.rejected(fault)
        if (ctx.reference && fault.code === 'invalid_limit') {
          throw new TediError(`The Tediware API rejected the code-list limit this build sent${detailOf(fault)}.`, {
            suggestions: [
              // `--limit` is already checked for a whole number >= 1, so reaching
              // here means the server's idea of a valid limit is not this build's.
              'Try `--all` for the complete list, or a smaller `--limit`.',
              'This build and the server disagree about what limits are allowed — run `tedi update`.',
            ],
          })
        }
        throw new TediError(`Tediware API request failed (${res.status} ${res.statusText})${detailOf(fault)}.`)
      }
      case 401:
        // A 401 with a key in hand means the server rejected that key (wrong key,
        // or a base URL pointed at a server that doesn't recognize it) — which is
        // a different problem from having no key at all. Branch on whether we
        // actually sent one rather than on the (server-worded) body.
        if (this.opts.token) throw new InvalidApiKeyError(this.base)
        throw new NotAuthenticatedError()
      case 403: {
        const msg = await this.readErrorMessage(res)
        // Unaccepted service terms and a disabled organization each get their
        // typed error; any other refusal (e.g. a sandbox key on an org-wide
        // data-plane endpoint) is worded by the server, so print that.
        if (/terms/i.test(msg)) throw new TermsNotAcceptedError()
        if (!msg || /unavailable/i.test(msg)) throw new AccountUnavailableError()
        throw new TediError(msg)
      }
      case 404: {
        const {missing, notFound, reference} = ctx
        if (reference) throw new NotFoundError(reference.kind, reference.code, reference.release)
        if (notFound) {
          const fault = await this.readFault(res)
          if (fault.code === 'not_found') throw new DataNotFoundError(notFound.kind, notFound.id)
          throw new TediError(`The server at ${this.base} has no ${notFound.kind} endpoint (HTTP 404).`, {
            suggestions: [
              'Check that api.baseUrl points at a current Tediware server (`tedi config get api.baseUrl`).',
            ],
          })
        }

        // Nothing was looked up by id, so a 404 means the route is not there —
        // "Record not found" would be answering a question nobody asked.
        if (missing) throw missing()
        throw new TediError('Record not found.')
      }
      case 429: {
        const header = res.headers.get('retry-after')
        const retry = header === null ? undefined : Number(header)
        throw new RateLimitedError(Number.isFinite(retry) ? retry : undefined)
      }
      default:
        break
    }

    const msg = await this.readErrorMessage(res)
    const detail = msg ? `: ${msg}` : ''
    throw new TediError(`Tediware API request failed (${res.status} ${res.statusText})${detail}.`)
  }

  private async reference(kind: ReferenceKind, code: string, req: ReferenceRequest): Promise<RenderedReference> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const resource = REFERENCE_RESOURCES[kind]
    const url = new URL(
      `${this.base}/api/x12/${encodeURIComponent(req.release)}/${resource}/${encodeURIComponent(code)}/download`,
    )
    // The CLI always sends an explicit variant and never leans on the server's
    // default, which has changed once already (markdown, now console — matching
    // the inspect endpoint). `color` is only meaningful for the console variant.
    url.searchParams.set('variant', req.format)
    if (req.color) url.searchParams.set('color', 'true')
    // Omitted entirely when the caller has no opinion, so the server keeps its
    // own default rather than this build pinning one that may later move.
    if (req.codeLimit !== undefined) url.searchParams.set('limit', String(req.codeLimit))

    const res = await this.send(url, {headers: this.authHeaders()})
    if (!res.ok) await this.throwForStatus(res, {reference: {kind, code, release: req.release}})

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
    const res = await this.send(`${this.base}/api/x12/releases`, {headers: this.authHeaders()})
    if (!res.ok) await this.throwForStatus(res)
    const payload = (await res.json()) as {data?: {releases?: RawRelease[]}}
    return (payload.data?.releases ?? []).map((r) => ({
      code: r.code,
      name: r.name ?? null,
      hipaa: Boolean(r.hipaa),
    }))
  }

  /**
   * `POST /api/edi/inspect` — the one call that sends the user's own data to the
   * platform. The document is uploaded verbatim (the command decides whether to
   * obfuscate first); the server parses it, validates against the licensed X12
   * standard, and returns the rendered report as text.
   *
   * A document the server could read answers 200 however broken it is: what it
   * got wrong comes back as findings, summarized in the response headers. A
   * non-2xx means the inspection did not happen at all.
   */
  async ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    assertInspectableSize(content)

    const body: Record<string, unknown> = {edi_content: content, variant: req.format}
    // As with the reference endpoints, `color` is sent only when we actually want
    // it, and only means anything for the console variant.
    if (req.color) body.color = true

    const res = await this.send(`${this.base}/api/edi/inspect`, {
      method: 'POST',
      headers: {...this.authHeaders(), 'content-type': 'application/json'},
      body: JSON.stringify(body),
      timeoutMs: INSPECT_TIMEOUT_MS,
    })
    if (!res.ok) {
      await this.throwForStatus(res, {
        rejected: inspectionRefusal,
        missing: () =>
          new TediError(`The server at ${this.base} has no EDI inspection endpoint (HTTP 404).`, {
            suggestions: [
              'Check that api.baseUrl points at a current Tediware server (`tedi config get api.baseUrl`).',
              'Reference lookups (`tedi x12 seg ISA`) work against older servers that predate inspection.',
            ],
          }),
      })
    }

    // The report is for the user; the headers are what the caller's exit code
    // turns on, since the rendered body is the server's to format and not
    // something to parse counts back out of.
    return {format: req.format, body: await res.text(), findings: readFindings(res.headers)}
  }

  /**
   * `GET /platform/whoami` — validates the key and reports its principal
   * without spending reference quota or touching org data. A 404 means the
   * server predates the endpoint; the typed error lets whoami/auth-status
   * degrade to the locally-known key instead of failing.
   */
  async whoami(): Promise<Identity> {
    const raw = await this.platformJson<{
      organization?: {id?: string; name?: string}
      keyScope?: string
      keyLabel?: string | null
      serviceTermsAccepted?: boolean
    }>('/platform/whoami', {missing: () => new IdentityUnavailableError()})
    return {
      organization: raw.organization?.name ?? '(unknown organization)',
      organizationId: raw.organization?.id ?? '',
      keyScope: raw.keyScope ?? 'standard',
      keyLabel: raw.keyLabel ?? null,
      termsAccepted: Boolean(raw.serviceTermsAccepted),
      keyHint: (this.opts.token ?? '').slice(-4),
    }
  }

  async transactionList(query: TransactionListQuery): Promise<Page<TransactionSummary>> {
    const url = new URL(`${this.base}/platform/edi_transactions`)
    applyQuery(url, {
      incoming: query.incoming,
      transaction_set_identifier: query.transactionSetIdentifier,
      trace: query.trace,
      ack_status: query.ackStatus,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<{ediTransactions?: TransactionSummary[]} & RawPagination>(url)
    return pageOf(raw.ediTransactions, raw)
  }

  async transactionGet(id: string): Promise<TransactionDetail> {
    return this.platformJson<TransactionDetail>(`/platform/edi_transactions/${encodeURIComponent(id)}`, {
      notFound: {kind: 'transaction', id},
    })
  }

  async transactionResend(id: string): Promise<{ediTransactionId: string}> {
    const raw = await this.platformJson<{ediTransactionId?: string}>(
      `/platform/edi_transactions/${encodeURIComponent(id)}/resend`,
      {
        notFound: {kind: 'transaction', id},
        method: 'POST',
        // A refused resend (inbound document, purged content, ...) arrives as a
        // nested {code, reason}; the server's message says which, so print it.
        rejected: (fault) => new TediError(fault.message || 'The resend was refused.'),
      },
    )
    return {ediTransactionId: raw.ediTransactionId ?? id}
  }

  async resultList(query: ResultListQuery): Promise<Page<PlatformResult>> {
    const url = new URL(`${this.base}/platform/results`)
    applyQuery(url, {node: query.node, trace: query.trace, limit: query.limit, cursor: query.cursor})
    const raw = await this.platformJson<{results?: PlatformResult[]} & RawPagination>(url)
    return pageOf(raw.results, raw)
  }

  async resultGet(id: string): Promise<PlatformResult> {
    return this.platformJson<PlatformResult>(`/platform/results/${encodeURIComponent(id)}`, {
      notFound: {kind: 'result', id},
    })
  }

  async logList(query: LogQuery): Promise<Page<LogLine>> {
    const url = new URL(`${this.base}/platform/logs`)
    applyQuery(url, {
      trace: query.trace,
      level: query.level,
      since: query.since,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<{logs?: LogLine[]} & RawPagination>(url)
    return pageOf(raw.logs, raw)
  }

  async feedList(query: FeedQuery): Promise<Page<FeedEntry>> {
    const url = new URL(`${this.base}/platform/feed_entries`)
    applyQuery(url, {
      direction: query.direction,
      status: query.status,
      partner: query.partner,
      trace: query.trace,
      since: query.since,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<{feedEntries?: FeedEntry[]} & RawPagination>(url)
    return pageOf(raw.feedEntries, raw)
  }

  /** `GET /platform/artifacts/:id` answers raw bytes, not JSON. */
  async artifactGet(id: string): Promise<ArtifactContent> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const res = await this.send(`${this.base}/platform/artifacts/${encodeURIComponent(id)}`, {
      headers: this.authHeaders(),
    })
    if (!res.ok) await this.throwForStatus(res, {notFound: {kind: 'artifact', id}})
    const disposition = res.headers.get('content-disposition') ?? ''
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type'),
      filename,
    }
  }

  async partnerSend(key: string, code: string, contents: unknown, filename?: string): Promise<PartnerSendReceipt> {
    const raw = await this.platformJson<PartnerSendReceipt>(
      `/platform/partners/${encodeURIComponent(key)}/ts/${encodeURIComponent(code)}`,
      {
        method: 'POST',
        body: {contents, filename},
        rejected: submissionRefusal,
        notFound: {kind: 'partner', id: key},
      },
    )
    return raw
  }

  async partnerReceive(key: string, contents: string, filename?: string): Promise<PartnerReceiveReceipt> {
    return this.platformJson<PartnerReceiveReceipt>(`/platform/partners/${encodeURIComponent(key)}/edi`, {
      method: 'POST',
      body: {contents, filename},
      rejected: submissionRefusal,
      notFound: {kind: 'partner', id: key},
    })
  }

  /**
   * Shared plumbing for the JSON data-plane endpoints: auth required, JSON in
   * and out, errors mapped through the one status mapper with per-call hooks
   * for 404 wording and rejected submissions.
   */
  private async platformJson<T>(
    path: string | URL,
    opts: ErrorContext & {method?: string; body?: unknown} = {},
  ): Promise<T> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const url = typeof path === 'string' ? `${this.base}${path}` : path
    const fetchOpts: FetchOptions = {headers: this.authHeaders(), method: opts.method}
    if (opts.body !== undefined) {
      fetchOpts.headers = {...fetchOpts.headers, 'content-type': 'application/json'}
      fetchOpts.body = JSON.stringify(opts.body)
    }

    const res = await this.send(url, fetchOpts)
    if (!res.ok) await this.throwForStatus(res, {missing: opts.missing, notFound: opts.notFound, rejected: opts.rejected})
    return (await res.json()) as T
  }
}

/** The pagination envelope every platform list answers with. */
interface RawPagination {
  pagination?: {hasMore?: boolean; nextCursor?: string | null}
}

function pageOf<T>(items: T[] | undefined, raw: RawPagination): Page<T> {
  return {
    items: items ?? [],
    hasMore: Boolean(raw.pagination?.hasMore),
    nextCursor: raw.pagination?.nextCursor ?? null,
  }
}

/**
 * Turn a rejected partner submission into the right error. Only `invalid_edi`
 * is a verdict on the caller's file; everything else (configuration errors,
 * missing parameters, an oversize body) is worded by the server and exits
 * "could not run".
 */
function submissionRefusal(fault: ServerFault): TediError {
  if (fault.code === 'invalid_edi') {
    return new TediError(fault.message || 'The file does not look like an X12 interchange.', {
      exitCode: EXIT_DEFECT,
    })
  }

  return new TediError(fault.message || `The submission was refused (HTTP ${fault.status}).`)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Whether to use the in-memory mock backend instead of the real Tediware API.
 *
 * The real HTTP client is the default: a published CLI must talk to the actual
 * platform, never serve synthetic data to a real user. The mock is opt-in for
 * local development and the test suite — enable it with a truthy `TEDI_API_MOCK`
 * (`1`, `true`, `yes`, `on`). Anything else (unset, `0`, `false`, …) hits the
 * real API described in `API.md`.
 */
export function useMock(): boolean {
  const value = (process.env.TEDI_API_MOCK ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(value)
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return useMock() ? new MockApiClient(opts) : new HttpApiClient(opts)
}
