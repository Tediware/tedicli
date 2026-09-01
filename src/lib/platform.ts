/**
 * Types and small helpers for the platform data plane (`/platform/...`).
 *
 * Unlike the licensed X12 reference, this is the caller's own operational data,
 * so structured access is the point: every data-plane command offers `--json`,
 * and these types mirror the serialized shapes in API.md field for field. The
 * human renderings live in the commands; nothing here formats.
 */

/** One page of a cursor-paginated listing. */
export interface Page<T> {
  items: T[]
  hasMore: boolean
  /**
   * Opaque cursor for the next page. On the feed this is also the tail
   * position: an empty page echoes the cursor you sent, so a poller can keep
   * asking "anything after here?" without re-reading.
   */
  nextCursor: string | null
}

/** Shared by every list query. */
export interface PageQuery {
  limit?: number
  cursor?: string
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
  traceGuid: string | null
  incoming: boolean
  acknowledgmentStatus?: 'accepted' | 'rejected' | 'unacknowledged'
  resendCount: number
  lastResentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TransactionListQuery extends PageQuery {
  /** Filter by direction; omit for both. */
  incoming?: boolean
  transactionSetIdentifier?: string
  trace?: string
  ackStatus?: string
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
  mappingFailed?: boolean
  partner?: {key: string}
  artifacts?: ArtifactPointer[]
  transformations?: string[]
  [key: string]: unknown
}

export interface PlatformResult {
  id: string
  traceGuid: string | null
  nodeName: string | null
  createdAt: string
  updatedAt: string
  detail: ResultDetail
}

export interface ResultListQuery extends PageQuery {
  node?: string
  trace?: string
}

/** The show shape: the envelope plus processing outcome and the trace's results. */
export interface TransactionDetail extends TransactionSummary {
  status: 'errored' | 'delivered'
  flowName?: string | null
  results: PlatformResult[]
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
}

/** A downloaded artifact: raw bytes plus what the server said about them. */
export interface ArtifactContent {
  bytes: Uint8Array
  contentType: string | null
  filename: string | null
}

/** Receipt for an own-shape outbound submission (`partner send`). */
export interface PartnerSendReceipt {
  interchangeControlNumber: string
  groupControlNumber: string
  traceGuid: string
}

/** Receipt for a raw-EDI inbound submission (`partner receive`). */
export interface PartnerReceiveReceipt {
  traceGuid: string
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
