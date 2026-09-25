/**
 * Types and small helpers for the platform data plane (`/platform/...`).
 *
 * Unlike the licensed X12 reference, this is the caller's own operational data,
 * so structured access is the point: every data-plane command offers `--json`,
 * and these types mirror the serialized shapes in API.md field for field. The
 * wire shape is the shape: `--json` passes the REST response through unchanged,
 * so the list envelopes here are the server's, not a CLI reshaping. The human
 * renderings live in the commands; nothing here formats.
 */

/** The pagination envelope every platform list answers with. */
export interface Pagination {
  hasMore: boolean
  /**
   * Opaque cursor for the next page. On the feed this is also the tail
   * position: an empty page echoes the cursor you sent, so a poller can keep
   * asking "anything after here?" without re-reading.
   */
  nextCursor: string | null
}

export interface Paged {
  pagination: Pagination
}

/** Shared by every list query. */
export interface PageQuery {
  limit?: number
  cursor?: string
}

export type Direction = 'inbound' | 'outbound'

/**
 * A non-fatal note a result raised on a document. Warnings are their own axis:
 * they never change `status`, so a delivered document that raised one still
 * reads `delivered`, and a caller that ignores them sees what it always saw.
 */
export interface Warning {
  /** Stable identifier to branch on; `mapping_failed` is the only one today. */
  code: string
  /** The prose to show a person. */
  message: string
  /** Extra structure whose shape depends on `code`; open-ended on purpose. */
  detail?: Record<string, unknown>
}

/** A warning as a transaction carries it: the same entry, plus who raised it. */
export interface TransactionWarning extends Warning {
  resultId: string
}

/** The list row for an EDI transaction (envelope metadata only). */
export interface TransactionSummary {
  id: string
  senderExtid: string | null
  senderQualifier: string | null
  receiverExtid: string | null
  receiverQualifier: string | null
  interchangeControlNumber: string | null
  groupControlNumber: string | null
  transactionSetControlNumber: string | null
  transactionSetIdentifier: string | null
  /** The PO, invoice or shipment number, on the sets that carry one. Absent on a server that predates it. */
  reference?: string | null
  traceGuid: string | null
  /** Shipped and kept; `direction` is the spelling to read. */
  incoming: boolean
  direction: Direction
  /** Absent on a server that predates the stored status. */
  status?: 'error' | 'delivered' | 'processing'
  /** How many warnings the document's results raised. Absent on a server that predates the channel. */
  warningCount?: number
  acknowledgmentStatus?: 'accepted' | 'rejected' | 'unacknowledged' | null
  partnerKey?: string | null
  duplicateOf?: string | null
  /** When the document left its delivery step, whatever the status. Absent on a server that predates it. */
  deliveredAt?: string | null
  resendCount: number
  lastResentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TransactionListQuery extends PageQuery {
  direction?: Direction
  transactionSetIdentifier?: string
  trace?: string
  ackStatus?: string
  status?: string
  partner?: string
  /** Business reference prefix: matches references that begin with it. */
  reference?: string
  /** True for only documents that raised warnings, false for only those that did not. */
  warnings?: boolean
  /**
   * Ask for the compact rows (API.md): a fixed, smaller set of fields per row.
   * The rows then carry only those fields, whatever the page type says, so
   * only `--json` output, which passes rows through untouched, sends it.
   */
  compact?: boolean
}

export interface TransactionPage extends Paged {
  ediTransactions: TransactionSummary[]
}

/** Pointer to a stored payload; the bytes come from `tedi artifact get`. */
export interface ArtifactPointer {
  id: string
  usage: string
  contentType?: string
  filename?: string
}

/**
 * The curated result detail (API.md). Open-ended on purpose: the server may add
 * fields, and the CLI passes the object through to `--json` untouched.
 */
export interface ResultDetail {
  direction?: string
  errorMessage?: string
  /** The individual findings behind `errorMessage`, when the failing step recorded them. */
  errors?: string[]
  mappingFailed?: boolean
  /** The warnings this result raised; the transaction's entries minus `resultId`. */
  warnings?: Warning[]
  resend?: boolean
  partner?: {key: string}
  artifacts?: ArtifactPointer[]
  transformations?: string[]
  /** On a failed result, the result whose payload the failing node received. */
  incomingResultId?: string
  [key: string]: unknown
}

/** What a result's payload is and how big, as the trace reports it; null when the result holds none. */
export interface PayloadPointer {
  format: string
  bytes: number
}

/**
 * The data a node produced, kept on its result (`GET /platform/results/:id/payload`).
 * Not an artifact: an artifact is a stored file a result points to.
 */
export interface ResultPayload {
  format: string
  /** An object for JSON, a string for EDI; the value at jsonPath when one was given. */
  contents: unknown
  jsonPath?: string
}

export interface ResultPayloadQuery {
  /** Dot-path into `contents`; numeric segments index arrays. */
  jsonPath?: string
  /** Replace `contents` with its shape: keys, types, array lengths. */
  keysOnly?: boolean
}

export interface PlatformResult {
  id: string
  traceGuid: string | null
  nodeName: string | null
  nodeId?: string | null
  status: 'success' | 'error'
  createdAt: string
  updatedAt: string
  detail: ResultDetail
  /** Present on the rows `GET /platform/traces/:guid` returns. */
  payload?: PayloadPointer | null
}

export interface ResultListQuery extends PageQuery {
  /** A node id or a node name (the server accepts either). */
  node?: string
  trace?: string
  status?: 'success' | 'error'
  /**
   * Ask for the compact rows (API.md): a fixed, smaller set of fields per row.
   * The rows then carry only those fields, whatever the page type says, so
   * only `--json` output, which passes rows through untouched, sends it.
   */
  compact?: boolean
}

export interface ResultPage extends Paged {
  results: PlatformResult[]
}

/**
 * One of the four artifact roles the transaction page derives. The result and
 * node always name who played the part; the pointer fields are present only
 * when that result carries an artifact for it.
 */
export interface ArtifactRole {
  id?: string
  usage?: string
  contentType?: string
  filename?: string
  resultId: string
  nodeName: string | null
}

/** The show shape: the envelope plus processing outcome and the transmission's own results. */
export interface TransactionDetail extends TransactionSummary {
  status: 'error' | 'delivered' | 'processing'
  flowName?: string | null
  traceErroredElsewhere?: boolean
  traceErroredElsewhereNodeName?: string | null
  acknowledges?: string | null
  acknowledgedBy?: string | null
  /** Every warning the transmission's results raised, each naming the result. */
  warnings?: TransactionWarning[]
  results: PlatformResult[]
  artifacts: {
    input: ArtifactRole | null
    output: ArtifactRole | null
    errored: ArtifactRole | null
    acknowledged: ArtifactRole | null
  }
}

export interface LogLine {
  id: string
  level: string
  message: string
  nodeName: string | null
  traceGuid: string
  createdAt: string
}

export interface LogQuery extends PageQuery {
  /** Required by the server; logs are always read per trace. */
  trace: string
  level?: string
  since?: string
}

export interface LogPage extends Paged {
  logs: LogLine[]
}

export interface FeedEntry {
  id: string
  direction: string
  status: string
  partnerKey: string | null
  traceGuid: string | null
  resultId: string | null
  createdAt: string
  detail: ResultDetail
}

export interface FeedQuery extends PageQuery {
  direction?: string
  status?: string
  partner?: string
  trace?: string
  since?: string
  /**
   * Ask for the compact rows (API.md): a fixed, smaller set of fields per row.
   * The rows then carry only those fields, whatever the page type says, so
   * only `--json` output, which passes rows through untouched, sends it.
   */
  compact?: boolean
}

export interface FeedPage extends Paged {
  feedEntries: FeedEntry[]
}

/** A downloaded artifact: raw bytes plus what the server said about them. */
export interface ArtifactContent {
  bytes: Uint8Array
  contentType: string | null
  filename: string | null
}

/** Receipt for an own-shape outbound submission (`partner send`). */
export interface PartnerSendReceipt {
  message?: string
  interchangeControlNumber: string
  groupControlNumber: string
  traceGuid: string
  ediTransactionId: string
}

/** The categories a suggestion may carry; the server refuses anything else. */
export const SUGGESTION_CATEGORIES = ['docs', 'api', 'feature', 'other'] as const
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number]

/** What `suggestion submit` sends. Absent optional fields are left out of the request. */
export interface SuggestionInput {
  body: string
  tried: string
  expected: string
  title?: string
  category?: SuggestionCategory
  reference?: string
  traceGuid?: string
}

/** A submitted suggestion. `duplicate` is set when the server returned an earlier one instead. */
export interface SuggestionReceipt {
  id: string
  title: string | null
  category: string | null
  status: string
  createdAt: string
  duplicate?: boolean
}

/** Receipt for a raw-EDI inbound submission (`partner receive`). */
export interface PartnerReceiveReceipt {
  message?: string
  traceGuid: string
}

/** Receipt for a resend (`transaction resend`). */
export interface ResendReceipt {
  message?: string
  ediTransactionId: string
  traceGuid?: string | null
}

/** A flow as it appears on a partner. */
export interface PartnerFlow {
  id?: string
  name?: string
  direction: Direction
  status: string
}

/** The list row of a partner. */
export interface PartnerSummary {
  id: string
  key: string
  name: string
  connection: {id: string; name: string; kind: string} | null
  inboundSets: string[]
  outboundSets: string[]
  flows: PartnerFlow[]
}

export interface PartnerPage extends Paged {
  partners: PartnerSummary[]
}

export interface PartnerConnection {
  id: string
  name: string
  kind: string
  host?: string | null
  port?: number | null
  username?: string | null
  inboundDirectory?: string | null
  outboundDirectory?: string | null
  as2Identifier?: string | null
  partnerAs2Identifier?: string | null
  partnerUrl?: string | null
  as2Ready?: boolean
  provisioned?: boolean
  [key: string]: unknown
}

export interface PartnerEnvelope {
  id: string
  name: string
  external: boolean
  interchangeExtid: string | null
  interchangeExtidQualifier: string | null
  applicationCode: string | null
  segmentSeparator?: string | null
  elementSeparator?: string | null
  componentSeparator?: string | null
  [key: string]: unknown
}

export interface PartnerWebhook {
  id: string
  name: string
  url: string
  kind: string
  contentType?: string | null
  [key: string]: unknown
}

export interface PartnerTransactionSet {
  transactionSetIdentifier: string
  direction: Direction
  mapping: {id: string; name: string} | null
  implementation: {id: string; name: string} | null
  directory?: string | null
}

/** The show shape of a partner: identity plus everything attached, embedded. */
export interface PartnerDetail {
  id: string
  key: string
  name: string
  startingInterchangeControlNumber?: number | null
  startingGroupControlNumber?: number | null
  autoAcknowledgeInbound?: boolean
  expectFunctionalAcknowledgments?: boolean
  deliveryMethod?: string | null
  connection: PartnerConnection | null
  internalEnvelope: PartnerEnvelope | null
  externalEnvelope: PartnerEnvelope | null
  inboundWebhook: PartnerWebhook | null
  outboundWebhook: PartnerWebhook | null
  errorWebhook: PartnerWebhook | null
  transactionSets: PartnerTransactionSet[]
  flows: PartnerFlow[]
  createdAt?: string
  updatedAt?: string
}

/** An artifact on a trace, labelled with the result and node that produced it. */
export interface TraceArtifact extends ArtifactPointer {
  resultId: string
  nodeName: string | null
}

/** Everything on one trace, from `GET /platform/traces/:guid`. */
export interface TraceDetail {
  traceGuid: string
  /** True while the pipeline is still running; the one thing to poll. */
  processing: boolean
  ediTransactions: TransactionSummary[]
  results: PlatformResult[]
  feedEntries: FeedEntry[]
  logs: LogLine[]
  artifacts: TraceArtifact[]
}

// ---------------------------------------------------------------------------
// The rest of the read-only control plane. Every resource that points at
// another does so as {id, name}, or {id, key, name} for a partner, and every
// resource lists what points at it.
// ---------------------------------------------------------------------------

export interface NamedRef {
  id: string
  name: string
}

export interface PartnerRef {
  id: string
  key: string
  name: string
}

export interface ConnectionSummary {
  id: string
  name: string
  kind: string
  host: string | null
  provisioned: boolean
  as2Ready: boolean
  partnerCount: number
  createdAt?: string
  updatedAt?: string
}

export interface ConnectionPage extends Paged {
  connections: ConnectionSummary[]
}

/** The partner embed plus the partners on it. */
export interface ConnectionDetail extends PartnerConnection {
  partners: PartnerRef[]
}

export interface EnvelopeSummary {
  id: string
  name: string
  external: boolean
  interchangeExtid: string | null
  interchangeExtidQualifier: string | null
  applicationCode: string | null
  createdAt?: string
  updatedAt?: string
}

export interface EnvelopePage extends Paged {
  envelopes: EnvelopeSummary[]
}

export interface EnvelopeDetail extends PartnerEnvelope {
  partners: (PartnerRef & {role: 'internal' | 'external'})[]
}

export interface WebhookSummary {
  id: string
  name: string
  kind: string
  url: string
  createdAt?: string
  updatedAt?: string
}

export interface WebhookPage extends Paged {
  webhooks: WebhookSummary[]
}

export interface WebhookDetail extends PartnerWebhook {
  partners: (PartnerRef & {role: 'inbound' | 'outbound' | 'error'})[]
}

export interface FlowSummary {
  id: string
  name: string
  direction: Direction
  status: string
  /** Polling interval in minutes; 0 is paused. */
  frequency: number
  versionNumber: number
  usesSandbox: boolean
  partner: PartnerRef
  createdAt?: string
  updatedAt?: string
}

export interface FlowListQuery extends PageQuery {
  partner?: string
  direction?: Direction
  status?: string
}

export interface FlowPage extends Paged {
  flows: FlowSummary[]
}

export interface FlowNode {
  id: string
  name: string
  kind: string
  service: string
}

export interface FlowDetail extends FlowSummary {
  nodes: FlowNode[]
  connections: {from: string; to: string}[]
}

export interface MappingSummary {
  id: string
  name: string
  direction: Direction
  implementation: NamedRef | null
  source: NamedRef | null
  currentVersion: number | null
  placeholderCount: number
  /** Keys of the partners whose transaction set settings use it. */
  partners: string[]
  createdAt?: string
  updatedAt?: string
}

export interface MappingListQuery extends PageQuery {
  direction?: Direction
  partner?: string
}

export interface MappingPage extends Paged {
  mappings: MappingSummary[]
}

export interface Placeholder {
  value: unknown
  reason: string | null
  position: number
  line: number
  column: number
}

export interface MappingVersion {
  /** Null on a mapping saved before versions existed. */
  versionNumber: number | null
  transformation: string
  placeholders: Placeholder[]
  note: string | null
  createdAt: string
  createdBy: {name: string} | null
}

export interface MappingVersionSummary {
  versionNumber: number
  note: string | null
  createdAt: string
  createdBy: {name: string} | null
}

export interface MappingVersionPage extends Paged {
  versions: MappingVersionSummary[]
}

export interface SourceSummary {
  id: string
  name: string
  mappings: NamedRef[]
  createdAt?: string
  updatedAt?: string
}

export interface SourcePage extends Paged {
  sources: SourceSummary[]
}

/** The embed on a mapping: the sample and the semantics note. */
export interface Source {
  id: string
  name: string
  sample: unknown
  semantics: string | null
  createdAt?: string
  updatedAt?: string
}

export interface SourceDetail extends Source {
  mappings: NamedRef[]
}

export interface MappingDetail extends Omit<MappingSummary, 'source'> {
  description: string | null
  tags: string[]
  source: Source | null
  current: MappingVersion | null
}

export interface ImplementationSummary {
  id: string
  name: string
  version: string | null
  transactionSet: {identifier: string; release: string}
  sourceImplementation: NamedRef | null
  segmentUseCount: number
  loopUseCount: number
  createdAt?: string
  updatedAt?: string
}

export interface ImplementationListQuery extends PageQuery {
  transactionSetIdentifier?: string
}

export interface ImplementationPage extends Paged {
  implementations: ImplementationSummary[]
}

export interface ImplementationDetail extends ImplementationSummary {
  description: string | null
  tags: string[]
  mappings: NamedRef[]
  partners: PartnerRef[]
}

/**
 * Append the query's defined entries to a URL, skipping undefined so the server
 * keeps its own defaults. Booleans serialize as `true`/`false` (the server's
 * strict enums), numbers via String().
 */
export function applyQuery(url: URL, query: Record<string, string | number | boolean | undefined>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
}
