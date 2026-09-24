/**
 * Thin client over the Tediware API.
 *
 * Per the brief, the CLI carries no proprietary logic and no licensed data: X12
 * reference rendering (including color and truncation) happens server-side, and
 * the client simply relays the requested format and returns what the server
 * renders. This module defines the client interface plus two implementations:
 *
 *   - `MockApiClient`   canned, clearly-synthetic responses so the CLI is fully
 *                       runnable before the server endpoints exist. The mock data
 *                       here is invented for development and is NOT licensed X12
 *                       reference content.
 *   - `HttpApiClient`   real HTTP client implementing the contract in `API.md`,
 *                       covering the X12 reference reads, EDI inspection, and
 *                       the platform data plane (`/platform/...`).
 *
 * `createApiClient` selects between them. The real HTTP client is the default so
 * a published CLI talks to the actual platform; set `TEDI_API_MOCK=1` to opt into
 * the mock for development or tests (no live server or real key required).
 */

import {OutputFormat} from './output.js'
import {
  AccountUnavailableError,
  ContractViolationError,
  DataNotFoundError,
  EdiTooLargeError,
  EXIT_DEFECT,
  IdentityUnavailableError,
  InspectionUnavailableError,
  InvalidApiKeyError,
  NoSuchEndpointError,
  NotAuthenticatedError,
  NotFoundError,
  NotJsonError,
  RateLimitedError,
  TediError,
  TermsNotAcceptedError,
  UnknownReleaseError,
  UnreadableDocumentError,
  UnsupportedReleaseError,
} from './errors.js'
import {fetchWithTimeout, FetchOptions} from './http.js'
import {
  applyQuery,
  ArtifactContent,
  ConnectionDetail,
  ConnectionPage,
  EnvelopeDetail,
  EnvelopePage,
  FeedPage,
  FeedQuery,
  FlowDetail,
  FlowListQuery,
  FlowPage,
  ImplementationDetail,
  ImplementationListQuery,
  ImplementationPage,
  LogPage,
  LogQuery,
  MappingDetail,
  MappingListQuery,
  MappingPage,
  MappingVersion,
  MappingVersionPage,
  PartnerDetail,
  PartnerPage,
  PartnerReceiveReceipt,
  SuggestionInput,
  SuggestionReceipt,
  PartnerSendReceipt,
  PageQuery,
  PlatformResult,
  ResultPayload,
  ResultPayloadQuery,
  ResendReceipt,
  ResultListQuery,
  ResultPage,
  SourceDetail,
  SourcePage,
  TraceDetail,
  TransactionDetail,
  TransactionListQuery,
  TransactionPage,
  TransactionSummary,
  WebhookDetail,
  WebhookPage,
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

/** One entry of the `releases` response, as the server sends it. */
export interface ReleaseInfo {
  id: number
  /** Release code, e.g. `004010`. This is what the CLI keys on, not the numeric id. */
  code: string
  /** Human-readable name, or null when the server hasn't set one. */
  name: string | null
  /** Whether this release is a HIPAA-designated version. */
  hipaa: boolean
  published_at: string | null
}

/** The `releases` response body, passed through by `x12 releases --json`. */
export interface ReleasesResponse {
  data: {releases: ReleaseInfo[]}
}

/** The principal behind the key, from `GET /platform/whoami`, as the server sends it. */
export interface Identity {
  organization: {id: string; name: string}
  keyScope: string
  /** The key's label as named in the dashboard, or null for an unnamed key. */
  keyLabel: string | null
  /** Whether the key's creator has accepted the current service terms. */
  serviceTermsAccepted: boolean
}

export interface ApiClient {
  readonly isMock: boolean
  readonly baseUrl: string
  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Releases(): Promise<ReleasesResponse>
  ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi>
  whoami(): Promise<Identity>
  transactionList(query: TransactionListQuery): Promise<TransactionPage>
  transactionGet(id: string): Promise<TransactionDetail>
  transactionResend(id: string): Promise<ResendReceipt>
  resultList(query: ResultListQuery): Promise<ResultPage>
  resultGet(id: string): Promise<PlatformResult>
  resultPayload(id: string, query: ResultPayloadQuery): Promise<ResultPayload>
  logList(query: LogQuery): Promise<LogPage>
  feedList(query: FeedQuery): Promise<FeedPage>
  artifactGet(id: string): Promise<ArtifactContent>
  partnerList(query: PageQuery): Promise<PartnerPage>
  partnerGet(key: string): Promise<PartnerDetail>
  partnerSend(key: string, code: string, contents: unknown, filename?: string): Promise<PartnerSendReceipt>
  partnerReceive(key: string, contents: string, filename?: string): Promise<PartnerReceiveReceipt>
  suggestionSubmit(input: SuggestionInput): Promise<SuggestionReceipt>
  traceGet(guid: string): Promise<TraceDetail>
  connectionList(query: PageQuery): Promise<ConnectionPage>
  connectionGet(id: string): Promise<ConnectionDetail>
  envelopeList(query: PageQuery): Promise<EnvelopePage>
  envelopeGet(id: string): Promise<EnvelopeDetail>
  webhookList(query: PageQuery): Promise<WebhookPage>
  webhookGet(id: string): Promise<WebhookDetail>
  flowList(query: FlowListQuery): Promise<FlowPage>
  flowGet(id: string): Promise<FlowDetail>
  mappingList(query: MappingListQuery): Promise<MappingPage>
  mappingGet(id: string): Promise<MappingDetail>
  mappingVersions(id: string, query: PageQuery): Promise<MappingVersionPage>
  mappingVersion(id: string, number: number): Promise<MappingVersion>
  implementationList(query: ImplementationListQuery): Promise<ImplementationPage>
  implementationGet(id: string): Promise<ImplementationDetail>
  /** The JSON schema a mapping targets, as parsed JSON. */
  implementationSchema(id: string): Promise<unknown>
  /** The rendered guide: presentation only, like the reference. */
  implementationGuide(id: string, format: OutputFormat): Promise<string>
  /** The portable export the import endpoint accepts, as parsed JSON. */
  implementationExport(id: string): Promise<unknown>
  sourceList(query: PageQuery): Promise<SourcePage>
  sourceGet(id: string): Promise<SourceDetail>
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
  /** Sent on every request so server logs can tell tedi from a browser. */
  userAgent?: string
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

// Oldest first, mirroring the server's ordering. Synthetic development data.
const MOCK_RELEASES: ReleaseInfo[] = [
  {id: 1, code: '004010', name: 'Release 004010', hipaa: false, published_at: '1997-10-01T00:00:00Z'},
  {id: 2, code: '005010', name: 'Release 005010', hipaa: true, published_at: '2003-05-01T00:00:00Z'},
  {id: 3, code: '006020', name: 'Release 006020', hipaa: false, published_at: '2010-11-01T00:00:00Z'},
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

/** The console rule widths the server's renderers use. */
const MOCK_TITLE_RULE = '='.repeat(94)
const MOCK_SECTION_RULE = '-'.repeat(94)
const MOCK_CODE_RULE = '-'.repeat(80)

/**
 * Development-only mock. All content here is synthetic and exists purely to make
 * the CLI runnable; it is not real licensed X12 reference data
 * (tedi:synthetic-data-ok). The console pages follow the server's real layout
 * (title line, `Release:` line, a title rule, sectioned tables, the element
 * truncation footer) so what the CLI does with a body is exercised against the
 * shape it will meet.
 */
export class MockApiClient implements ApiClient {
  readonly isMock = true

  constructor(private readonly opts: ApiClientOptions) {}

  get baseUrl(): string {
    return this.opts.baseUrl
  }

  private requireToken(): void {
    if (!this.opts.token) throw new NotAuthenticatedError(this.opts.baseUrl)
  }

  private render(title: string, req: ReferenceRequest, sections: string[][], markdown: string[]): RenderedReference {
    if (req.format === 'markdown') {
      const body = [`# ${title}`, '', `> Release: ${req.release}`, '', '_(synthetic development data, not licensed X12 reference)_', '', ...markdown, ''].join('\n')
      return {release: req.release, format: 'markdown', body}
    }
    const lines = [title, `Release: ${req.release}`, '', MOCK_TITLE_RULE, '']
    for (const section of sections) lines.push(...section, '')
    return {release: req.release, format: 'console', body: lines.join('\n')}
  }

  async x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    // Echo the id as received; case normalization is the command's job.
    return this.render(
      `${id} - Synthetic Segment`,
      req,
      [
        [
          'Elements',
          'Ref        Element    Name                                Type   Requirement  Length   Repeat',
          MOCK_SECTION_RULE,
          `${id}-01      9001       Synthetic Qualifier                 ID     Mandatory    2/3`,
          `${id}-02      9002       Synthetic Text                      AN     Conditional  1/60`,
        ],
        ['Syntax Rules', MOCK_SECTION_RULE, `Q0102    Synthetic rule spanning ${id}-01 and ${id}-02`],
      ],
      [`## Segment ${id}`, '', `- **${id}-01** (Mandatory) Synthetic Qualifier`, `- **${id}-02** (Conditional) Synthetic Text`],
    )
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
        ? ['', `${codes.length} codes; showing ${shown.length}. Pass --all for the full list, or pipe the output.`]
        : []
    return this.render(
      `${id} - Synthetic Element`,
      req,
      [
        ['Type:          ID', 'Min Length:    1', 'Max Length:    3'],
        ['Allowed Codes', MOCK_CODE_RULE, ...shown.map(([code, name]) => `${code.padEnd(11)}${name}`), ...footer],
      ],
      [`## Element ${id}`, '', ...codes.map(([code, name]) => `- \`${code}\` ${name}`)],
    )
  }

  async x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render(
      `${id} - Synthetic Transaction Set`,
      req,
      [
        [
          'Heading',
          'Pos    Segment   Name                                Requirement  Max Use',
          MOCK_SECTION_RULE,
          '010    ZZA       Synthetic Opening Segment           Mandatory    1',
        ],
        ['Detail', MOCK_SECTION_RULE, '010    ZZB       Synthetic Grouping Segment          Mandatory    >1'],
        ['Summary', MOCK_SECTION_RULE, '010    ZZC       Synthetic Closing Segment           Mandatory    1'],
      ],
      [`## Transaction Set ${id}`, '', '- 010 **ZZA** (Mandatory) Synthetic Opening Segment', '- 010 **ZZC** (Mandatory) Synthetic Closing Segment'],
    )
  }

  async x12Releases(): Promise<ReleasesResponse> {
    return {data: {releases: MOCK_RELEASES}}
  }

  async ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi> {
    this.requireToken()
    assertInspectableSize(content)
    // The mock does not parse EDI. It counts segments crudely so a developer can
    // still see the command's plumbing (and the effect of --obfuscate) end to end.
    const segments = content
      .split(/[~\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const first = /^[A-Za-z0-9]+/.exec(segments[0] ?? '')?.[0]?.toUpperCase() ?? '(none)'
    const header =
      req.format === 'markdown'
        ? ['# EDI inspection', '', '_(synthetic development data; the mock backend does not parse EDI)_', '']
        : ['EDI inspection    [mock]', '']
    return {
      format: req.format,
      body: [
        ...header,
        `Segments: ${segments.length}`,
        `First segment: ${first}`,
        '',
        'Findings: none (synthetic; no parsing or validation happened).',
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
      organization: {id: 'mock-org-0000', name: 'Acme EDI (dev)'},
      keyScope: 'standard',
      keyLabel: 'Development key',
      serviceTermsAccepted: true,
    }
  }

  async transactionList(query: TransactionListQuery): Promise<TransactionPage> {
    this.requireToken()
    let rows = MOCK_TRANSACTIONS
    if (query.direction) rows = rows.filter((t) => t.direction === query.direction)
    if (query.transactionSetIdentifier) {
      rows = rows.filter((t) => t.transactionSetIdentifier === query.transactionSetIdentifier)
    }
    if (query.partner) rows = rows.filter((t) => t.partnerKey?.toLowerCase() === query.partner?.toLowerCase())
    if (query.trace) rows = rows.filter((t) => t.traceGuid === query.trace)
    if (query.status) rows = rows.filter((t) => t.status === query.status)
    if (query.warnings !== undefined) rows = rows.filter((t) => ((t.warningCount ?? 0) > 0) === query.warnings)
    return {ediTransactions: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async transactionGet(id: string): Promise<TransactionDetail> {
    this.requireToken()
    const row = MOCK_TRANSACTIONS.find((t) => t.id === id)
    if (!row) throw new DataNotFoundError('transaction', id)
    const own = MOCK_RESULTS.filter((r) => r.traceGuid === row.traceGuid)
    // The server gathers a transaction's warnings from its own results and
    // stamps each with the result that raised it; the mock does the same so the
    // count on the list row and the array on the show cannot drift apart.
    const warnings = own.flatMap((r) => (r.detail.warnings ?? []).map((w) => ({...w, resultId: r.id})))
    // Each role is the artifact whose usage plays that part, labeled with the
    // result that wrote it, as the server derives them.
    const role = (usage: string) => {
      for (const r of own) {
        const found = r.detail.artifacts?.find((a) => a.usage === usage)
        if (found) return {...found, resultId: r.id, nodeName: r.nodeName}
      }
      return null
    }
    return {
      ...row,
      status: 'delivered',
      warningCount: warnings.length,
      warnings,
      flowName: 'Mock Inbound Flow',
      traceErroredElsewhere: false,
      acknowledges: null,
      acknowledgedBy: null,
      results: own,
      artifacts: {
        input: role('input'),
        output: role('output'),
        errored: role('errored'),
        acknowledged: role('acknowledged'),
      },
    }
  }

  async transactionResend(id: string): Promise<ResendReceipt> {
    this.requireToken()
    const row = MOCK_TRANSACTIONS.find((t) => t.id === id)
    if (!row) throw new DataNotFoundError('transaction', id)
    return {ediTransactionId: id, traceGuid: row.traceGuid}
  }

  async resultList(query: ResultListQuery): Promise<ResultPage> {
    this.requireToken()
    let rows = MOCK_RESULTS
    if (query.trace) rows = rows.filter((r) => r.traceGuid === query.trace)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.node) rows = rows.filter((r) => r.nodeId === query.node || r.nodeName?.toLowerCase() === query.node?.toLowerCase())
    return {results: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async resultGet(id: string): Promise<PlatformResult> {
    this.requireToken()
    const row = MOCK_RESULTS.find((r) => r.id === id)
    if (!row) throw new DataNotFoundError('result', id)
    return row
  }

  async resultPayload(id: string, query: ResultPayloadQuery): Promise<ResultPayload> {
    this.requireToken()
    const payload = MOCK_PAYLOADS[id]
    if (!payload) throw new DataNotFoundError('result', id)
    let contents: unknown = payload.contents
    if (query.jsonPath) {
      if (query.jsonPath.split('.').includes('')) {
        throw new TediError(`jsonPath has an empty segment: '${query.jsonPath}'`, {code: 'invalid_parameter'})
      }
      for (const key of query.jsonPath.split('.')) {
        contents = contents !== null && typeof contents === 'object' ? (contents as Record<string, unknown>)[key] : undefined
      }
      if (contents === undefined) {
        throw new TediError(`Path '${query.jsonPath}' not found in the payload of result ${id}.`, {exitCode: EXIT_DEFECT, code: 'not_found'})
      }
    }
    if (query.keysOnly) contents = mockShape(contents)
    return {format: payload.format, contents, ...(query.jsonPath ? {jsonPath: query.jsonPath} : {})}
  }

  async logList(query: LogQuery): Promise<LogPage> {
    this.requireToken()
    let rows = MOCK_LOGS.filter((l) => l.traceGuid === query.trace)
    if (query.level) rows = rows.filter((l) => l.level === query.level)
    return {logs: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async feedList(query: FeedQuery): Promise<FeedPage> {
    this.requireToken()
    let rows = MOCK_FEED
    if (query.direction) rows = rows.filter((f) => f.direction === query.direction)
    if (query.status) rows = rows.filter((f) => f.status === query.status)
    // An empty page echoes the cursor, matching the server's tail contract.
    if (query.cursor) return {feedEntries: [], pagination: {hasMore: false, nextCursor: query.cursor}}
    return {feedEntries: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: 'mock-cursor-1'}}
  }

  async artifactGet(id: string): Promise<ArtifactContent> {
    this.requireToken()
    if (!MOCK_RESULTS.some((r) => r.detail.artifacts?.some((a) => a.id === id))) {
      throw new DataNotFoundError('artifact', id)
    }

    return {
      bytes: new TextEncoder().encode('ISA*00*(synthetic development artifact, not real EDI)~'),
      contentType: 'application/edi-x12',
      filename: 'mock.edi',
    }
  }

  async partnerList(query: PageQuery): Promise<PartnerPage> {
    this.requireToken()
    return {partners: MOCK_PARTNERS.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async partnerGet(key: string): Promise<PartnerDetail> {
    this.requireToken()
    const row = MOCK_PARTNERS.find((p) => p.key === key.toUpperCase())
    if (!row) throw new DataNotFoundError('partner', key)
    return MOCK_PARTNER_DETAIL
  }

  async partnerSend(key: string): Promise<PartnerSendReceipt> {
    this.requireToken()
    // The FAILING partner's trace ends in a validation error and the HANGING
    // partner's never finishes, so both --wait exit paths are exercisable
    // against the mock.
    const upper = key.toUpperCase()
    const traceGuid = upper === 'FAILING' ? MOCK_FAILING_TRACE : upper === 'HANGING' ? MOCK_HANGING_TRACE : 'mock-trace-outbound'
    return {
      interchangeControlNumber: '000000001',
      groupControlNumber: '000000001',
      traceGuid,
      ediTransactionId: upper === 'FAILING' ? 'mock-txn-3' : 'mock-txn-2',
    }
  }

  async partnerReceive(): Promise<PartnerReceiveReceipt> {
    this.requireToken()
    return {traceGuid: MOCK_TRACE}
  }

  async suggestionSubmit(input: SuggestionInput): Promise<SuggestionReceipt> {
    this.requireToken()
    // A title of CAPPED meets the daily cap and DUPLICATE an earlier
    // submission, so every exit path is exercisable against the mock.
    const title = input.title?.toUpperCase()
    if (title === 'CAPPED') {
      throw dailyCapRefusal('This organization has submitted 20 suggestions in the last 24 hours, the most allowed. Do not retry.')
    }
    return {
      id: 'mock-suggestion-1',
      title: input.title ?? null,
      category: input.category ?? null,
      status: 'new',
      createdAt: '2026-01-01T12:00:00Z',
      ...(title === 'DUPLICATE' ? {duplicate: true} : {}),
    }
  }

  async traceGet(guid: string): Promise<TraceDetail> {
    this.requireToken()
    if (guid === MOCK_HANGING_TRACE) {
      return {traceGuid: guid, processing: true, ediTransactions: [], results: [], feedEntries: [], logs: [], artifacts: []}
    }
    const transactions = MOCK_TRANSACTIONS.filter((t) => t.traceGuid === guid)
    const results = [...MOCK_RESULTS, MOCK_FAILED_RESULT].filter((r) => r.traceGuid === guid)
    if (transactions.length === 0 && results.length === 0) throw new DataNotFoundError('trace', guid)
    return {
      traceGuid: guid,
      processing: false,
      ediTransactions: transactions,
      results: results.map((r) => {
        const payload = MOCK_PAYLOADS[r.id]
        return {...r, payload: payload ? {format: payload.format, bytes: JSON.stringify(payload).length} : null}
      }),
      feedEntries: MOCK_FEED.filter((f) => f.traceGuid === guid),
      logs: MOCK_LOGS.filter((l) => l.traceGuid === guid),
      artifacts: results.flatMap((r) => (r.detail.artifacts ?? []).map((a) => ({...a, resultId: r.id, nodeName: r.nodeName}))),
    }
  }

  // --- The rest of the read-only control plane ------------------------------

  async connectionList(query: PageQuery): Promise<ConnectionPage> {
    this.requireToken()
    return {connections: MOCK_CONNECTIONS.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async connectionGet(id: string): Promise<ConnectionDetail> {
    this.requireToken()
    if (id !== MOCK_CONNECTION_DETAIL.id) throw new DataNotFoundError('connection', id)
    return MOCK_CONNECTION_DETAIL
  }

  async envelopeList(query: PageQuery): Promise<EnvelopePage> {
    this.requireToken()
    return {envelopes: MOCK_ENVELOPES.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async envelopeGet(id: string): Promise<EnvelopeDetail> {
    this.requireToken()
    const row = MOCK_ENVELOPES.find((e) => e.id === id)
    if (!row) throw new DataNotFoundError('envelope', id)
    return {
      ...row,
      segmentSeparator: '~',
      elementSeparator: '*',
      componentSeparator: '>',
      partners: [{...MOCK_PARTNER_REF, role: row.external ? 'external' : 'internal'}],
    }
  }

  async webhookList(query: PageQuery): Promise<WebhookPage> {
    this.requireToken()
    return {webhooks: MOCK_WEBHOOKS.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async webhookGet(id: string): Promise<WebhookDetail> {
    this.requireToken()
    const row = MOCK_WEBHOOKS.find((w) => w.id === id)
    if (!row) throw new DataNotFoundError('webhook', id)
    return {...row, contentType: 'application/json', partners: [{...MOCK_PARTNER_REF, role: 'inbound'}]}
  }

  async flowList(query: FlowListQuery): Promise<FlowPage> {
    this.requireToken()
    let rows = MOCK_FLOWS
    if (query.partner && query.partner.toUpperCase() !== MOCK_PARTNER_REF.key) rows = []
    if (query.direction) rows = rows.filter((f) => f.direction === query.direction)
    if (query.status) rows = rows.filter((f) => f.status === query.status)
    return {flows: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async flowGet(id: string): Promise<FlowDetail> {
    this.requireToken()
    const row = MOCK_FLOWS.find((f) => f.id === id)
    if (!row) throw new DataNotFoundError('flow', id)
    return {
      ...row,
      nodes: [
        {id: 'mock-node-1', name: 'Partner endpoint', kind: 'input', service: 'partner_endpoint'},
        {id: 'mock-node-2', name: 'Acme 856 mapping', kind: 'transformation', service: 'mapping'},
        {id: 'mock-node-3', name: 'Upload', kind: 'output', service: 'sftp_upload'},
      ],
      connections: [
        {from: 'mock-node-1', to: 'mock-node-2'},
        {from: 'mock-node-2', to: 'mock-node-3'},
      ],
    }
  }

  async mappingList(query: MappingListQuery): Promise<MappingPage> {
    this.requireToken()
    let rows = MOCK_MAPPINGS
    if (query.partner && query.partner.toUpperCase() !== MOCK_PARTNER_REF.key) rows = []
    if (query.direction) rows = rows.filter((m) => m.direction === query.direction)
    return {mappings: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async mappingGet(id: string): Promise<MappingDetail> {
    this.requireToken()
    const row = MOCK_MAPPINGS.find((m) => m.id === id)
    if (!row) throw new DataNotFoundError('mapping', id)
    return {
      ...row,
      description: 'Ships to Acme.',
      tags: [],
      source: row.source ? MOCK_SOURCE : null,
      current: MOCK_MAPPING_VERSIONS[MOCK_MAPPING_VERSIONS.length - 1] ?? null,
    }
  }

  async mappingVersions(id: string, query: PageQuery): Promise<MappingVersionPage> {
    this.requireToken()
    if (!MOCK_MAPPINGS.some((m) => m.id === id)) throw new DataNotFoundError('mapping', id)
    const versions = MOCK_MAPPING_VERSIONS.map(({versionNumber, note, createdAt, createdBy}) => ({
      versionNumber: versionNumber as number,
      note,
      createdAt,
      createdBy,
    }))
    return {versions: versions.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async mappingVersion(id: string, number: number): Promise<MappingVersion> {
    this.requireToken()
    if (!MOCK_MAPPINGS.some((m) => m.id === id)) throw new DataNotFoundError('mapping', id)
    const version = MOCK_MAPPING_VERSIONS.find((v) => v.versionNumber === number)
    if (!version) {
      // Same sentence and hint the HTTP client derives from a
      // reason: "mapping_version" 404.
      throw new TediError(`No version ${number} of mapping ${id}.`, {
        exitCode: EXIT_DEFECT,
        code: 'not_found',
        suggestions: [`Run \`tedi mapping versions ${id}\` to list its versions.`],
      })
    }
    return version
  }

  async implementationList(query: ImplementationListQuery): Promise<ImplementationPage> {
    this.requireToken()
    let rows = MOCK_IMPLEMENTATIONS
    if (query.transactionSetIdentifier) {
      rows = rows.filter((i) => i.transactionSet.identifier === query.transactionSetIdentifier)
    }
    return {implementations: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async implementationGet(id: string): Promise<ImplementationDetail> {
    this.requireToken()
    const row = MOCK_IMPLEMENTATIONS.find((i) => i.id === id)
    if (!row) throw new DataNotFoundError('implementation', id)
    return {...row, description: 'Acme outbound shipments.', tags: [], mappings: [], partners: [MOCK_PARTNER_REF]}
  }

  async implementationSchema(id: string): Promise<unknown> {
    this.requireToken()
    if (!MOCK_IMPLEMENTATIONS.some((i) => i.id === id)) throw new DataNotFoundError('implementation', id)
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {heading: {type: 'object'}, detail: {type: 'object'}},
      required: ['heading'],
    }
  }

  async implementationGuide(id: string, format: OutputFormat): Promise<string> {
    this.requireToken()
    if (!MOCK_IMPLEMENTATIONS.some((i) => i.id === id)) throw new DataNotFoundError('implementation', id)
    // Invented placeholder structure, deliberately not real X12 content.
    return format === 'markdown'
      ? '# Acme 856 (v1)\n\nTransaction set: SH856 - Synthetic Set\nRelease: 004010\n\n## Heading\n\n- 0100 **ZZA** (Required) - Synthetic Opening Segment\n'
      : 'Acme 856 (v1)\nTransaction Set: SH856 - Synthetic Set\nRelease: 004010\n\nHeading\n\nR  ZZA - Synthetic Opening Segment\n'
  }

  async implementationExport(id: string): Promise<unknown> {
    this.requireToken()
    const row = MOCK_IMPLEMENTATIONS.find((i) => i.id === id)
    if (!row) throw new DataNotFoundError('implementation', id)
    return {
      format_version: 1,
      exported_at: '2026-01-01T00:00:00Z',
      implementation: {
        name: row.name,
        release_code: row.transactionSet.release,
        transaction_set_code: row.transactionSet.identifier,
        hl_levels: [],
        loop_uses: [],
        segment_uses: [],
      },
    }
  }

  async sourceList(query: PageQuery): Promise<SourcePage> {
    this.requireToken()
    const rows = [{id: MOCK_SOURCE.id, name: MOCK_SOURCE.name, mappings: [{id: 'mock-mapping-2', name: 'Acme 856'}]}]
    return {sources: rows.slice(0, query.limit ?? 50), pagination: {hasMore: false, nextCursor: null}}
  }

  async sourceGet(id: string): Promise<SourceDetail> {
    this.requireToken()
    if (id !== MOCK_SOURCE.id) throw new DataNotFoundError('source', id)
    return {...MOCK_SOURCE, mappings: [{id: 'mock-mapping-2', name: 'Acme 856'}]}
  }
}

// Synthetic development data for the platform surface: fixed ids so tests and
// manual exploration can address records without a discovery step.
const MOCK_TRACE = 'aaaaaaaa-0000-0000-0000-000000000001'

const MOCK_PARTNER_REF = {id: 'mock-partner-1', key: 'ACME', name: 'Acme Retail'}

const MOCK_CONNECTIONS: ConnectionPage['connections'] = [
  {id: 'mock-connection-1', name: 'Acme SFTP', kind: 'sftp', host: 'sftp.example.invalid', provisioned: true, as2Ready: false, partnerCount: 1},
]

const MOCK_CONNECTION_DETAIL: ConnectionDetail = {
  id: 'mock-connection-1',
  name: 'Acme SFTP',
  kind: 'sftp',
  host: 'sftp.example.invalid',
  port: 22,
  username: 'acme',
  inboundDirectory: '/in',
  outboundDirectory: '/out',
  provisioned: true,
  as2Ready: false,
  partners: [MOCK_PARTNER_REF],
}

const MOCK_ENVELOPES: EnvelopePage['envelopes'] = [
  {id: 'mock-envelope-1', name: 'Us', external: false, interchangeExtid: 'SENDERID', interchangeExtidQualifier: 'ZZ', applicationCode: 'SENDERID'},
  {id: 'mock-envelope-2', name: 'Acme', external: true, interchangeExtid: 'RECEIVERID', interchangeExtidQualifier: 'ZZ', applicationCode: 'RECEIVERID'},
]

const MOCK_WEBHOOKS: WebhookPage['webhooks'] = [
  {id: 'mock-webhook-1', name: 'Orders', kind: 'standard', url: 'https://example.invalid/hooks/orders'},
]

const MOCK_FLOWS: FlowPage['flows'] = [
  {id: 'mock-flow-1', name: 'Acme Inbound', direction: 'inbound', status: 'active', frequency: 5, versionNumber: 1, usesSandbox: false, partner: MOCK_PARTNER_REF},
  {id: 'mock-flow-2', name: 'Acme Outbound', direction: 'outbound', status: 'active', frequency: 0, versionNumber: 2, usesSandbox: false, partner: MOCK_PARTNER_REF},
]

const MOCK_SOURCE = {
  id: 'mock-source-1',
  name: 'Shipment',
  sample: {shipment: {number: 'SH-1', lines: [{sku: 'A1', qty: 2}]}},
  semantics: 'One shipment with its lines.',
}

const MOCK_MAPPINGS: MappingPage['mappings'] = [
  {id: 'mock-mapping-1', name: 'Acme 850', direction: 'inbound', implementation: {id: 'mock-impl-2', name: 'Acme 850'}, source: null, currentVersion: 1, placeholderCount: 0, partners: ['ACME']},
  {id: 'mock-mapping-2', name: 'Acme 856', direction: 'outbound', implementation: {id: 'mock-impl-1', name: 'Acme 856'}, source: {id: 'mock-source-1', name: 'Shipment'}, currentVersion: 2, placeholderCount: 1, partners: ['ACME']},
]

const MOCK_MAPPING_VERSIONS: MappingVersion[] = [
  {versionNumber: 1, transformation: '{ "heading": {} }', placeholders: [], note: null, createdAt: '2026-01-01T00:00:00Z', createdBy: {name: 'Dev'}},
  {
    versionNumber: 2,
    transformation: '{ "heading": { "carrier": $placeholder("SCAC", "not in source") } }',
    placeholders: [{value: 'SCAC', reason: 'not in source', position: 27, line: 1, column: 28}],
    note: 'Added carrier placeholder',
    createdAt: '2026-01-02T00:00:00Z',
    createdBy: {name: 'Dev'},
  },
]

const MOCK_IMPLEMENTATIONS: ImplementationPage['implementations'] = [
  {id: 'mock-impl-1', name: 'Acme 856', version: '1', status: 'active', transactionSet: {identifier: '856', release: '004010'}, sourceImplementation: null, segmentUseCount: 12, loopUseCount: 3},
  {id: 'mock-impl-2', name: 'Acme 850', version: '1', status: 'draft', transactionSet: {identifier: '850', release: '004010'}, sourceImplementation: {id: 'mock-public-1', name: 'Public 850'}, segmentUseCount: 20, loopUseCount: 4},
]
const MOCK_FAILING_TRACE = 'mock-trace-failing'
const MOCK_HANGING_TRACE = 'mock-trace-hanging'

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
    direction: 'inbound',
    status: 'delivered',
    warningCount: 0,
    acknowledgmentStatus: null,
    partnerKey: 'ACME',
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
    traceGuid: 'mock-trace-outbound',
    incoming: false,
    direction: 'outbound',
    status: 'delivered',
    warningCount: 1,
    acknowledgmentStatus: 'accepted',
    partnerKey: 'ACME',
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
    nodeId: 'mock-node-1',
    status: 'success',
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:01Z',
    detail: {
      direction: 'inbound',
      partner: {key: 'ACME'},
      artifacts: [
        {id: 'mock-artifact-1', usage: 'input', contentType: 'application/edi-x12', filename: 'in.edi'},
      ],
      transformations: ['EDI Endpoint', 'EDI to JSON'],
    },
  },
  // Delivered with a warning: `status` stays success and `mappingFailed` stays
  // where it was, and the warning channel says the same thing in the shape
  // every code can branch on.
  {
    id: 'mock-result-2',
    traceGuid: 'mock-trace-outbound',
    nodeName: 'JSON to EDI',
    nodeId: 'mock-node-3',
    status: 'success',
    createdAt: '2026-01-02T12:00:00Z',
    updatedAt: '2026-01-02T12:00:01Z',
    detail: {
      direction: 'outbound',
      partner: {key: 'ACME'},
      mappingFailed: true,
      warnings: [
        {
          code: 'mapping_failed',
          message: '(synthetic) The mapping produced no document; the source was delivered unmapped.',
          detail: {mappingName: 'Mock Acme 856'},
        },
      ],
      artifacts: [{id: 'mock-artifact-2', usage: 'output', contentType: 'application/edi-x12', filename: 'out.edi'}],
    },
  },
]

const MOCK_FAILED_RESULT: PlatformResult = {
  id: 'mock-result-failed',
  traceGuid: MOCK_FAILING_TRACE,
  nodeName: 'Validation + EDI Write',
  nodeId: 'mock-node-2',
  status: 'error',
  createdAt: '2026-01-03T12:00:00Z',
  updatedAt: '2026-01-03T12:00:00Z',
  detail: {
    direction: 'outbound',
    errorMessage: "Validation failed against implementation 'Mock 850': 2 errors.",
    errors: ["/heading/BEG must have required property 'purchase_order_number_03'", '/detail/PO1/0 must have required property quantity_02'],
    incomingResultId: 'mock-result-mapped',
  },
}

// Keyed by result id. The failed result's payload is its error; the mapped
// document it refused is the payload of its incomingResultId.
const MOCK_PAYLOADS: Record<string, ResultPayload> = {
  'mock-result-1': {format: 'edi', contents: 'ISA*00*(synthetic development payload, not real EDI)~'},
  'mock-result-2': {format: 'edi', contents: 'ISA*00*(synthetic outbound payload)~'},
  'mock-result-mapped': {
    format: 'json',
    contents: {heading: {BEG: {transaction_set_purpose_code_01: '00'}}, detail: {PO1: [{assigned_identification_01: '1'}]}},
  },
  'mock-result-failed': {format: 'error', contents: {error: "Validation failed against implementation 'Mock 850': 2 errors."}},
}

function mockShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return {_type: 'array', _length: value.length, _sample: depth < 4 && value.length > 0 ? mockShape(value[0], depth + 1) : null}
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= 4) return {_type: 'object', _keys: Object.keys(value).length}
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mockShape(v, depth + 1)]))
  }
  return value === null ? 'nilclass' : typeof value
}

const MOCK_LOGS: LogPage['logs'] = [
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

const MOCK_FEED: FeedPage['feedEntries'] = [
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
        {id: 'mock-artifact-1', usage: 'input', contentType: 'application/edi-x12', filename: 'in.edi'},
      ],
    },
  },
]

const MOCK_PARTNERS: PartnerPage['partners'] = [
  {
    id: 'mock-partner-1',
    key: 'ACME',
    name: 'Acme Retail',
    connection: {id: 'mock-connection-1', name: 'Acme SFTP', kind: 'sftp'},
    inboundSets: ['850'],
    outboundSets: ['856', '810'],
    flows: [
      {direction: 'inbound', status: 'active'},
      {direction: 'outbound', status: 'active'},
    ],
  },
]

const MOCK_PARTNER_DETAIL: PartnerDetail = {
  id: 'mock-partner-1',
  key: 'ACME',
  name: 'Acme Retail',
  startingInterchangeControlNumber: 1000,
  startingGroupControlNumber: 1000,
  deliveryMethod: 'webhook',
  connection: {
    id: 'mock-connection-1',
    name: 'Acme SFTP',
    kind: 'sftp',
    host: 'sftp.example.invalid',
    port: 22,
    username: 'acme',
    inboundDirectory: '/in',
    outboundDirectory: '/out',
    provisioned: true,
    as2Ready: false,
  },
  internalEnvelope: {
    id: 'mock-envelope-1',
    name: 'Us',
    external: false,
    interchangeExtid: 'SENDERID',
    interchangeExtidQualifier: 'ZZ',
    applicationCode: 'SENDERID',
  },
  externalEnvelope: {
    id: 'mock-envelope-2',
    name: 'Acme',
    external: true,
    interchangeExtid: 'RECEIVERID',
    interchangeExtidQualifier: 'ZZ',
    applicationCode: 'RECEIVERID',
  },
  inboundWebhook: {id: 'mock-webhook-1', name: 'Orders', url: 'https://example.invalid/hooks/orders', kind: 'standard'},
  outboundWebhook: null,
  errorWebhook: null,
  transactionSets: [
    {transactionSetIdentifier: '850', direction: 'inbound', mapping: {id: 'mock-mapping-1', name: 'Acme 850'}, implementation: null},
    {transactionSetIdentifier: '856', direction: 'outbound', mapping: null, implementation: {id: 'mock-impl-1', name: 'Acme 856'}},
    {transactionSetIdentifier: '810', direction: 'outbound', mapping: null, implementation: null},
  ],
  flows: [
    {id: 'mock-flow-1', name: 'Acme Inbound', direction: 'inbound', status: 'active'},
    {id: 'mock-flow-2', name: 'Acme Outbound', direction: 'outbound', status: 'active'},
  ],
}

// ---------------------------------------------------------------------------
// HTTP implementation
// ---------------------------------------------------------------------------

/** The reference resources and how they map to a path segment and a noun for errors. */
const REFERENCE_RESOURCES = {
  segment: 'segments',
  element: 'elements',
  'transaction set': 'transaction_sets',
} as const

type ReferenceKind = keyof typeof REFERENCE_RESOURCES

/**
 * A refusal, as the server states it: a human message plus a stable machine
 * `code` (absent on the auth and throttle responses, and on any server old
 * enough to predate the codes) and, on the data plane, a `reason` naming the
 * condition within the code.
 */
export interface ServerFault {
  message: string
  code?: string
  reason?: string
  status: number
  /** Whether the body was JSON at all. A routing 404 from an HTML page is not. */
  json: boolean
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
  /** Builds the error for a JSON 404 that is not a record miss (the route is absent on this server). */
  missing?: () => TediError
  /**
   * Data-plane lookup by id. A 404 here is ambiguous: a genuine miss carries
   * `code: "not_found"` in the body, while a wrong base URL or a server too
   * old to have the route answers something else, and only the first is a
   * verdict the CLI may assert (exit 1). The second must not tell CI the
   * record does not exist.
   */
  notFound?: {kind: string; id: string; serverMessage?: boolean}
  /** Builds the error for a 429 the server explained; undefined falls back to the generic rate limit. */
  limited?: (fault: ServerFault) => TediError | undefined
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
 * not understand, and the whole point here is to say "unknown" instead.
 */
function readCount(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined
  return Number(raw.trim())
}

/**
 * The wait a 429's Retry-After asks for, in whole seconds. Tediware sends
 * delta-seconds; a proxy may rewrite the header into the HTTP-date form, which
 * is read against the clock. Unknown shapes mean no hint, never a wrong one.
 */
export function retryAfterSeconds(raw: string | null, now: number = Date.now()): number | undefined {
  if (raw === null) return undefined
  const value = raw.trim()
  if (/^\d+$/.test(value)) return Number(value)
  // An HTTP-date starts with a weekday name; Date.parse alone reads far too
  // much (a bare "-5" parses as a year).
  if (!/^[A-Za-z]/.test(value)) return undefined
  const at = Date.parse(value)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, Math.ceil((at - now) / 1000))
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
 * (missing and non-string content answered 422 before they answered 400, and an
 * oversize body now answers 413) while the codes are the stable half of the
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
          `This build refuses anything over ${MAX_INSPECT_BYTES / 1024} KB before uploading, so the server's limit has moved. Run \`tedi update\` for a build that knows the current one.`,
        ],
        code: fault.code,
      })
    case 'invalid_parameter':
    case 'invalid_variant':
    case 'missing_parameter':
      // The CLI builds every part of this request bar the document itself.
      return new TediError(`The Tediware API rejected this request (${fault.code})${detail}.`, {
        suggestions: [
          'This is a fault in the CLI rather than in your document. Run `tedi update`, and report it if a current version still fails.',
        ],
        code: fault.code,
      })
    default:
      // No code, or one this build has not heard of. A 422 has always meant the
      // document could not be read; anything else is not about the document.
      if (fault.status === 422) return new UnreadableDocumentError(fault.message)
      return new TediError(`The Tediware API refused this inspection (HTTP ${fault.status})${detail}.`, {code: fault.code})
  }
}

/**
 * A 400 the server attributes to a parameter. On the data plane the only
 * parameters are the ones the caller typed (a cursor, a since, a filter), so
 * this is worded as the caller's input rather than as an outage.
 */
function parameterRefusal(fault: ServerFault): TediError {
  const message = fault.message.replace(/\s*\.\s*$/, '')
  const suggestions: string[] = []
  if (/cursor/i.test(message)) {
    suggestions.push('--cursor takes the nextCursor value from a previous page of the same list, on the same server.')
  }
  if (/since|timestamp|time/i.test(message)) {
    suggestions.push('--since takes an ISO 8601 timestamp with a zone (2026-08-19T13:21:19Z), a bare date, or a relative form like 2h.')
  }
  return new TediError(`The server rejected one of the values you passed: ${message}.`, {
    suggestions,
    code: fault.code,
  })
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

  get baseUrl(): string {
    return this.base
  }

  private get base(): string {
    return this.opts.baseUrl.replace(/\/+$/, '')
  }

  /** API.md: every request authenticates with `Authorization: Key <api_key>`. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.opts.userAgent ? {'user-agent': this.opts.userAgent} : {}),
      ...(this.opts.token ? {authorization: `Key ${this.opts.token}`} : {}),
      ...extra,
    }
  }

  /**
   * `fetchWithTimeout`, with an unreachable server turned into something the
   * user can act on.
   *
   * Left alone, a DNS miss, a refused connection, or a stalled request escapes
   * as a raw `TypeError: fetch failed`. That is not a `TediError`, so it reaches
   * the user as a stack trace and oclif exits 1 for it, telling a CI job the
   * document is bad when the CLI never got as far as asking about it. The whole
   * point of the 1/2 split is to not say that.
   */
  private async send(url: string | URL, opts: FetchOptions = {}): Promise<Response> {
    try {
      return await fetchWithTimeout(url, opts)
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      const whereToLook = `Confirm api.baseUrl points where you expect. It is currently ${this.base} (\`tedi config get api.baseUrl\`).`
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
   * The one guarded JSON read for a 2xx. A body that is not JSON is almost
   * always a wrong base URL (a login page, a proxy), and a raw SyntaxError out
   * of `res.json()` would say nothing of the kind.
   */
  private async readJson<T>(res: Response): Promise<T> {
    const text = await res.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw new NotJsonError(this.base, res.headers.get('content-type'))
    }
  }

  /**
   * Best-effort read of the server's account of a refusal.
   *
   * Two body shapes are in play (API.md): the flat `{error, code}` the
   * controllers return, and the platform envelope, where `error` is itself an
   * object carrying `message`, `code` and sometimes `reason`. Both are read
   * here so the caller never has to care which one it got.
   */
  private async readFault(res: Response): Promise<ServerFault> {
    const fault: ServerFault = {message: '', status: res.status, json: false}
    try {
      const body = JSON.parse(await res.text()) as {error?: unknown; code?: unknown}
      fault.json = true
      const err = body?.error
      if (typeof err === 'string') fault.message = err
      else if (err && typeof err === 'object') {
        const nested = err as {message?: unknown; code?: unknown; reason?: unknown}
        if (typeof nested.message === 'string') fault.message = nested.message
        if (typeof nested.code === 'string') fault.code = nested.code
        if (typeof nested.reason === 'string') fault.reason = nested.reason
      }
      if (typeof body?.code === 'string') fault.code = body.code
    } catch {
      // Non-JSON or empty body; the caller falls back to a generic message.
    }
    return fault
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
        // Request-shaped failures. Only `inspect` and the submissions can
        // legitimately produce one, since their payload is the user's; they
        // read the `code` to work out whose fault the refusal is. For
        // reference lookups the CLI builds every parameter and validates
        // `--limit` before sending, so one of these is a bug, but
        // `invalid_limit` is at least traceable to something the user typed,
        // so name it instead of printing a bare status.
        const fault = await this.readFault(res)
        if (ctx.rejected) throw ctx.rejected(fault)
        if (ctx.reference && fault.code === 'invalid_limit') {
          throw new TediError(`The Tediware API rejected the code-list limit this build sent${detailOf(fault)}.`, {
            suggestions: [
              // `--limit` is already checked for a whole number >= 1, so reaching
              // here means the server's idea of a valid limit is not this build's.
              'Try `--all` for the complete list, or a smaller `--limit`.',
              'This build and the server disagree about what limits are allowed. Run `tedi update`.',
            ],
            code: fault.code,
          })
        }
        if (fault.code === 'invalid_parameter') throw parameterRefusal(fault)
        throw new TediError(`Tediware API request failed (${res.status} ${res.statusText})${detailOf(fault)}.`, {
          code: fault.code,
        })
      }
      case 401:
        // A 401 with a key in hand means the server rejected that key (wrong key,
        // or a base URL pointed at a server that doesn't recognize it), which is
        // a different problem from having no key at all. Branch on whether we
        // actually sent one rather than on the (server-worded) body.
        if (this.opts.token) throw new InvalidApiKeyError(this.base)
        throw new NotAuthenticatedError(this.base)
      case 403: {
        const fault = await this.readFault(res)
        // Unaccepted service terms and a disabled organization each get their
        // typed error; any other refusal (e.g. a sandbox key on an org-wide
        // data-plane endpoint) is worded by the server, so print that.
        if (/terms/i.test(fault.message)) throw new TermsNotAcceptedError(this.base)
        if (!fault.message || /unavailable/i.test(fault.message)) throw new AccountUnavailableError()
        throw new TediError(fault.message, {code: fault.code})
      }
      case 404: {
        const fault = await this.readFault(res)
        // Without the plane's JSON shape this is not a Tediware answer at all:
        // a path on the base URL, a proxy, or a server with no such route.
        if (!fault.json || fault.code === 'no_route') {
          if (ctx.missing && fault.json) throw ctx.missing()
          throw new NoSuchEndpointError(this.base)
        }
        const {notFound, reference} = ctx
        if (reference) {
          if (fault.code === 'unknown_release') throw new UnknownReleaseError(reference.release, fault.message)
          throw new NotFoundError(reference.kind, reference.code, reference.release)
        }
        if (notFound) {
          if (fault.code === 'not_found') {
            // The partner endpoints answer 404 for the partner and for a
            // transaction set it does not take; `reason` says which, and the
            // second is the server's sentence to print.
            if (fault.reason === 'transaction_set') {
              throw new TediError(fault.message || `Transaction set ${notFound.id} is not configured on this partner.`, {
                exitCode: EXIT_DEFECT,
                code: fault.code,
                suggestions: [`Run \`tedi partner get ${notFound.id}\` to see which sets the partner takes in each direction.`],
              })
            }
            // The mapping exists and the version does not; the server's
            // sentence names both.
            if (fault.reason === 'mapping_version') {
              throw new TediError(fault.message || `No such version of mapping '${notFound.id}'.`, {
                exitCode: EXIT_DEFECT,
                code: fault.code,
                suggestions: [`Run \`tedi mapping versions ${notFound.id}\` to list its versions.`],
              })
            }
            if (notFound.serverMessage && fault.message) {
              throw new TediError(fault.message, {exitCode: EXIT_DEFECT, code: fault.code})
            }
            throw new DataNotFoundError(notFound.kind, notFound.id)
          }
          throw new NoSuchEndpointError(this.base)
        }
        if (ctx.missing) throw ctx.missing()
        throw new NoSuchEndpointError(this.base)
      }
      case 429: {
        const retryAfter = retryAfterSeconds(res.headers.get('retry-after'))
        const explained = ctx.limited?.(await this.readFault(res))
        throw explained ?? new RateLimitedError(retryAfter)
      }
      default:
        break
    }

    const fault = await this.readFault(res)
    throw new TediError(`Tediware API request failed (${res.status} ${res.statusText})${detailOf(fault)}.`, {
      code: fault.code,
    })
  }

  private async reference(kind: ReferenceKind, code: string, req: ReferenceRequest): Promise<RenderedReference> {
    if (!this.opts.token) throw new NotAuthenticatedError(this.base)
    const resource = REFERENCE_RESOURCES[kind]
    const url = new URL(
      `${this.base}/api/x12/${encodeURIComponent(req.release)}/${resource}/${encodeURIComponent(code)}/download`,
    )
    // The CLI always sends an explicit variant and never leans on the server's
    // default, which has changed once already (markdown, now console, matching
    // the inspect endpoint). `color` is only meaningful for the console variant.
    url.searchParams.set('variant', req.format)
    if (req.color) url.searchParams.set('color', 'true')
    // Omitted entirely when the caller has no opinion, so the server keeps its
    // own default rather than this build pinning one that may later move.
    if (req.codeLimit !== undefined) url.searchParams.set('limit', String(req.codeLimit))

    const res = await this.send(url, {headers: this.headers()})
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
    return this.reference('transaction set', id, req)
  }

  async x12Releases(): Promise<ReleasesResponse> {
    // `releases` is reachable without a key, but API.md asks us to send the header
    // anyway so usage counts against the per-key limit rather than only the per-IP one.
    const res = await this.send(`${this.base}/api/x12/releases`, {headers: this.headers()})
    if (!res.ok) await this.throwForStatus(res)
    const payload = await this.readJson<{data?: {releases?: ReleaseInfo[]}}>(res)
    if (!Array.isArray(payload?.data?.releases)) throw new ContractViolationError('a release list', this.base)
    return {data: {releases: payload.data.releases}}
  }

  /**
   * `POST /api/edi/inspect`: the one call that sends the user's own data to the
   * platform. The document is uploaded verbatim (the command decides whether to
   * obfuscate first); the server parses it, validates against the licensed X12
   * standard, and returns the rendered report as text.
   *
   * A document the server could read answers 200 however broken it is: what it
   * got wrong comes back as findings, summarized in the response headers. A
   * non-2xx means the inspection did not happen at all.
   */
  async ediInspect(content: string, req: InspectionRequest): Promise<InspectedEdi> {
    if (!this.opts.token) throw new NotAuthenticatedError(this.base)
    assertInspectableSize(content)

    const body: Record<string, unknown> = {edi_content: content, variant: req.format}
    // As with the reference endpoints, `color` is sent only when we actually want
    // it, and only means anything for the console variant.
    if (req.color) body.color = true

    const res = await this.send(`${this.base}/api/edi/inspect`, {
      method: 'POST',
      headers: this.headers({'content-type': 'application/json'}),
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
   * `GET /platform/whoami`: validates the key and reports its principal
   * without spending reference quota or touching org data. A JSON 404 means
   * the server predates the endpoint; the typed error lets whoami/auth-status
   * degrade to the locally-known key instead of failing. A field the contract
   * promises but the server omits is a violation, not something to default:
   * a key that "looks standard" because the server said nothing is exactly
   * the wrong answer for an identity check.
   */
  async whoami(): Promise<Identity> {
    const raw = await this.platformJson<Partial<Identity>>('/platform/whoami', {
      missing: () => new IdentityUnavailableError(),
    })
    const organization = raw.organization
    if (!organization || typeof organization.id !== 'string' || typeof organization.name !== 'string') {
      throw new ContractViolationError('an organization', this.base)
    }
    if (typeof raw.keyScope !== 'string') throw new ContractViolationError('a key scope', this.base)
    return {
      organization: {id: organization.id, name: organization.name},
      keyScope: raw.keyScope,
      keyLabel: typeof raw.keyLabel === 'string' ? raw.keyLabel : null,
      serviceTermsAccepted: raw.serviceTermsAccepted === true,
    }
  }

  async transactionList(query: TransactionListQuery): Promise<TransactionPage> {
    const url = new URL(`${this.base}/platform/edi_transactions`)
    applyQuery(url, {
      direction: query.direction,
      transaction_set_identifier: query.transactionSetIdentifier,
      trace: query.trace,
      ack_status: query.ackStatus,
      status: query.status,
      partner: query.partner,
      warnings: query.warnings,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<Partial<TransactionPage>>(url)
    return {ediTransactions: raw.ediTransactions ?? [], pagination: paginationOf(raw)}
  }

  async transactionGet(id: string): Promise<TransactionDetail> {
    return this.platformJson<TransactionDetail>(`/platform/edi_transactions/${encodeURIComponent(id)}`, {
      notFound: {kind: 'transaction', id},
    })
  }

  async transactionResend(id: string): Promise<ResendReceipt> {
    const raw = await this.platformJson<Partial<ResendReceipt>>(
      `/platform/edi_transactions/${encodeURIComponent(id)}/resend`,
      {
        notFound: {kind: 'transaction', id},
        method: 'POST',
        // A refused resend (inbound document, purged content, ...) arrives as a
        // nested {code, reason}; the server's message says which, so print it.
        rejected: (fault) => new TediError(fault.message || 'The resend was refused.', {code: fault.code}),
      },
    )
    return {...raw, ediTransactionId: raw.ediTransactionId ?? id}
  }

  async resultList(query: ResultListQuery): Promise<ResultPage> {
    const url = new URL(`${this.base}/platform/results`)
    applyQuery(url, {
      node: query.node,
      trace: query.trace,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<Partial<ResultPage>>(url)
    return {results: raw.results ?? [], pagination: paginationOf(raw)}
  }

  async resultGet(id: string): Promise<PlatformResult> {
    return this.platformJson<PlatformResult>(`/platform/results/${encodeURIComponent(id)}`, {
      notFound: {kind: 'result', id},
    })
  }

  async resultPayload(id: string, query: ResultPayloadQuery): Promise<ResultPayload> {
    const url = new URL(`${this.base}/platform/results/${encodeURIComponent(id)}/payload`)
    applyQuery(url, {jsonPath: query.jsonPath, keysOnly: query.keysOnly ? 'true' : undefined})
    // The server's sentence says why: results age out after 45 days, and a
    // jsonPath that does not resolve names the path.
    return this.platformJson<ResultPayload>(url, {notFound: {kind: 'result', id, serverMessage: true}})
  }

  async logList(query: LogQuery): Promise<LogPage> {
    const url = new URL(`${this.base}/platform/logs`)
    applyQuery(url, {
      trace: query.trace,
      level: query.level,
      since: query.since,
      limit: query.limit,
      cursor: query.cursor,
    })
    const raw = await this.platformJson<Partial<LogPage>>(url)
    return {logs: raw.logs ?? [], pagination: paginationOf(raw)}
  }

  async feedList(query: FeedQuery): Promise<FeedPage> {
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
    const raw = await this.platformJson<Partial<FeedPage>>(url)
    return {feedEntries: raw.feedEntries ?? [], pagination: paginationOf(raw)}
  }

  /** `GET /platform/artifacts/:id` answers raw bytes, not JSON. */
  async artifactGet(id: string): Promise<ArtifactContent> {
    if (!this.opts.token) throw new NotAuthenticatedError(this.base)
    const res = await this.send(`${this.base}/platform/artifacts/${encodeURIComponent(id)}`, {
      headers: this.headers(),
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

  async partnerList(query: PageQuery): Promise<PartnerPage> {
    const url = new URL(`${this.base}/platform/partners`)
    applyQuery(url, {limit: query.limit, cursor: query.cursor})
    const raw = await this.platformJson<Partial<PartnerPage>>(url)
    return {partners: raw.partners ?? [], pagination: paginationOf(raw)}
  }

  async partnerGet(key: string): Promise<PartnerDetail> {
    return this.platformJson<PartnerDetail>(`/platform/partners/${encodeURIComponent(key)}`, {
      notFound: {kind: 'partner', id: key},
    })
  }

  async partnerSend(key: string, code: string, contents: unknown, filename?: string): Promise<PartnerSendReceipt> {
    return this.platformJson<PartnerSendReceipt>(
      `/platform/partners/${encodeURIComponent(key)}/ts/${encodeURIComponent(code)}`,
      {
        method: 'POST',
        body: {contents, filename},
        rejected: submissionRefusal,
        // The 404 names the partner or, by `reason`, the set; the id here is
        // whichever the reason turns out to be about.
        notFound: {kind: 'partner', id: key},
      },
    )
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
   * `POST /platform/suggestions`. A repeat answers 200 with the earlier
   * suggestion and `duplicate: true`; the daily cap answers 429 with
   * `reason: "daily_cap"` and a sentence telling the caller not to retry.
   */
  async suggestionSubmit(input: SuggestionInput): Promise<SuggestionReceipt> {
    return this.platformJson<SuggestionReceipt>('/platform/suggestions', {
      method: 'POST',
      body: input,
      rejected: submissionRefusal,
      limited: (fault) => (fault.reason === 'daily_cap' ? dailyCapRefusal(fault.message) : undefined),
    })
  }

  async traceGet(guid: string): Promise<TraceDetail> {
    return this.platformJson<TraceDetail>(`/platform/traces/${encodeURIComponent(guid)}`, {
      notFound: {kind: 'trace', id: guid},
    })
  }

  // --- The rest of the read-only control plane ------------------------------

  async connectionList(query: PageQuery): Promise<ConnectionPage> {
    const raw = await this.platformList<Partial<ConnectionPage>>('connections', query)
    return {connections: raw.connections ?? [], pagination: paginationOf(raw)}
  }

  connectionGet(id: string): Promise<ConnectionDetail> {
    return this.platformShow<ConnectionDetail>('connections', 'connection', id)
  }

  async envelopeList(query: PageQuery): Promise<EnvelopePage> {
    const raw = await this.platformList<Partial<EnvelopePage>>('envelopes', query)
    return {envelopes: raw.envelopes ?? [], pagination: paginationOf(raw)}
  }

  envelopeGet(id: string): Promise<EnvelopeDetail> {
    return this.platformShow<EnvelopeDetail>('envelopes', 'envelope', id)
  }

  async webhookList(query: PageQuery): Promise<WebhookPage> {
    const raw = await this.platformList<Partial<WebhookPage>>('webhooks', query)
    return {webhooks: raw.webhooks ?? [], pagination: paginationOf(raw)}
  }

  webhookGet(id: string): Promise<WebhookDetail> {
    return this.platformShow<WebhookDetail>('webhooks', 'webhook', id)
  }

  async flowList(query: FlowListQuery): Promise<FlowPage> {
    const raw = await this.platformList<Partial<FlowPage>>('flows', query, {
      partner: query.partner,
      direction: query.direction,
      status: query.status,
    })
    return {flows: raw.flows ?? [], pagination: paginationOf(raw)}
  }

  flowGet(id: string): Promise<FlowDetail> {
    return this.platformShow<FlowDetail>('flows', 'flow', id)
  }

  async mappingList(query: MappingListQuery): Promise<MappingPage> {
    const raw = await this.platformList<Partial<MappingPage>>('mappings', query, {
      direction: query.direction,
      partner: query.partner,
    })
    return {mappings: raw.mappings ?? [], pagination: paginationOf(raw)}
  }

  mappingGet(id: string): Promise<MappingDetail> {
    return this.platformShow<MappingDetail>('mappings', 'mapping', id)
  }

  async mappingVersions(id: string, query: PageQuery): Promise<MappingVersionPage> {
    const raw = await this.platformList<Partial<MappingVersionPage>>(`mappings/${encodeURIComponent(id)}/versions`, query, {}, {
      kind: 'mapping',
      id,
    })
    return {versions: raw.versions ?? [], pagination: paginationOf(raw)}
  }

  mappingVersion(id: string, number: number): Promise<MappingVersion> {
    // The 404 is the mapping's or the version's; `reason: "mapping_version"`
    // marks the second, and throwForStatus prints the server's sentence for
    // it (which names the version and the mapping).
    return this.platformJson<MappingVersion>(`/platform/mappings/${encodeURIComponent(id)}/versions/${number}`, {
      notFound: {kind: 'mapping', id},
    })
  }

  async implementationList(query: ImplementationListQuery): Promise<ImplementationPage> {
    const raw = await this.platformList<Partial<ImplementationPage>>('implementations', query, {
      transactionSetIdentifier: query.transactionSetIdentifier,
    })
    return {implementations: raw.implementations ?? [], pagination: paginationOf(raw)}
  }

  implementationGet(id: string): Promise<ImplementationDetail> {
    return this.platformShow<ImplementationDetail>('implementations', 'implementation', id)
  }

  implementationSchema(id: string): Promise<unknown> {
    return this.platformJson<unknown>(`/platform/implementations/${encodeURIComponent(id)}/schema`, {
      notFound: {kind: 'implementation', id},
    })
  }

  async implementationGuide(id: string, format: OutputFormat): Promise<string> {
    if (!this.opts.token) throw new NotAuthenticatedError(this.base)
    const url = new URL(`${this.base}/platform/implementations/${encodeURIComponent(id)}/guide`)
    url.searchParams.set('variant', format)
    const res = await this.send(url, {headers: this.headers()})
    if (!res.ok) await this.throwForStatus(res, {notFound: {kind: 'implementation', id}})
    return res.text()
  }

  implementationExport(id: string): Promise<unknown> {
    return this.platformJson<unknown>(`/platform/implementations/${encodeURIComponent(id)}/export`, {
      notFound: {kind: 'implementation', id},
    })
  }

  async sourceList(query: PageQuery): Promise<SourcePage> {
    const raw = await this.platformList<Partial<SourcePage>>('sources', query)
    return {sources: raw.sources ?? [], pagination: paginationOf(raw)}
  }

  sourceGet(id: string): Promise<SourceDetail> {
    return this.platformShow<SourceDetail>('sources', 'source', id)
  }

  /** A control-plane list: the shared page query plus the resource's own filters. */
  private platformList<T>(
    path: string,
    page: PageQuery,
    filters: Record<string, string | number | boolean | undefined> = {},
    notFound?: {kind: string; id: string},
  ): Promise<T> {
    const url = new URL(`${this.base}/platform/${path}`)
    applyQuery(url, {...filters, limit: page.limit, cursor: page.cursor})
    return this.platformJson<T>(url, notFound ? {notFound} : {})
  }

  /** A control-plane show by id; the 404 names the resource and the id. */
  private platformShow<T>(path: string, kind: string, id: string): Promise<T> {
    return this.platformJson<T>(`/platform/${path}/${encodeURIComponent(id)}`, {notFound: {kind, id}})
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
    if (!this.opts.token) throw new NotAuthenticatedError(this.base)
    const url = typeof path === 'string' ? `${this.base}${path}` : path
    const fetchOpts: FetchOptions = {headers: this.headers(), method: opts.method}
    if (opts.body !== undefined) {
      fetchOpts.headers = this.headers({'content-type': 'application/json'})
      fetchOpts.body = JSON.stringify(opts.body)
    }

    const res = await this.send(url, fetchOpts)
    if (!res.ok) {
      await this.throwForStatus(res, {missing: opts.missing, notFound: opts.notFound, rejected: opts.rejected, limited: opts.limited})
    }
    return this.readJson<T>(res)
  }
}

function paginationOf(raw: {pagination?: Partial<{hasMore: boolean; nextCursor: string | null}>}): {
  hasMore: boolean
  nextCursor: string | null
} {
  return {hasMore: Boolean(raw.pagination?.hasMore), nextCursor: raw.pagination?.nextCursor ?? null}
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
      code: fault.code,
    })
  }
  if (fault.code === 'invalid_parameter') return parameterRefusal(fault)
  return new TediError(fault.message || `The submission was refused (HTTP ${fault.status}).`, {code: fault.code})
}

/**
 * The organization's daily suggestion allowance is used up. The server's
 * sentence says not to retry, and no suggestion is added: a retry hint here
 * would undo the point of the cap.
 */
function dailyCapRefusal(message: string): TediError {
  return new TediError(message || 'The daily suggestion limit is reached. Do not retry.', {code: 'rate_limited'})
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Whether to use the in-memory mock backend instead of the real Tediware API.
 *
 * The real HTTP client is the default: a published CLI must talk to the actual
 * platform, never serve synthetic data to a real user. The mock is opt-in for
 * local development and the test suite: enable it with a truthy `TEDI_API_MOCK`
 * (`1`, `true`, `yes`, `on`). Anything else (unset, `0`, `false`, ...) hits the
 * real API described in `API.md`.
 */
export function useMock(): boolean {
  const value = (process.env.TEDI_API_MOCK ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(value)
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return useMock() ? new MockApiClient(opts) : new HttpApiClient(opts)
}
