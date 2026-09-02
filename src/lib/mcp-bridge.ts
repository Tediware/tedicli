/**
 * The stdio-to-HTTP bridge behind `tedi mcp serve`.
 *
 * The real MCP server is `POST /mcp` on the platform (API.md, "MCP"). This
 * module exists for MCP clients that only launch stdio subprocesses, and for the
 * auth convenience: the bridge sends the credential from `tedi auth login`, so a
 * key never has to be pasted into an agent's config file.
 *
 * It contains no tool logic. Each line on stdin is one JSON-RPC message; each
 * request becomes one HTTP POST whose body is that message unchanged, and the
 * server's JSON-RPC reply is written back as one line. The only messages the
 * bridge authors itself are the ones a transport adapter has to: parse and
 * framing errors, a missing protocol version (the server reports that as a
 * header mismatch, which means nothing on a transport with no headers), and
 * failures that never produced a JSON-RPC body (a 429 from the rate limiter,
 * an unreachable server, a timeout).
 *
 * Per the stdio binding, nothing but MCP messages may be written to the output
 * stream. Diagnostics go to `stderr`.
 */

import {createInterface} from 'node:readline'
import type {Readable, Writable} from 'node:stream'

/** The only protocol revision the platform serves; named in the error a version-less request gets. */
export const MCP_PROTOCOL_VERSION = '2026-07-28'

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'

/**
 * Documents ride in tool arguments (edi_inspect, partner_receive), so this is
 * the inspect deadline rather than the reference one.
 */
export const MCP_TIMEOUT_MS = 60_000

/** JSON-RPC and MCP error codes the bridge writes itself. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  INVALID_PARAMS: -32602,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  /**
   * Implementation-defined (-32000..-32019). The server spends -32000 on
   * authorization; these two are the bridge's, for failures that reached it as
   * something other than a JSON-RPC body.
   */
  RATE_LIMITED: -32001,
  UPSTREAM_UNAVAILABLE: -32002,
} as const

/** Header names the Streamable HTTP binding requires on every POST. */
export const HEADER = {
  PROTOCOL_VERSION: 'MCP-Protocol-Version',
  METHOD: 'Mcp-Method',
  NAME: 'Mcp-Name',
} as const

/** Methods that carry `Mcp-Name`, and the body field it mirrors. */
const NAME_FIELD: Record<string, 'name' | 'uri'> = {
  'tools/call': 'name',
  'resources/read': 'uri',
  'prompts/get': 'name',
}

type JsonRpcId = string | number | null

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A header value must be visible ASCII with no leading or trailing whitespace;
 * anything else (and any plain value that happens to look like the sentinel)
 * is carried Base64-wrapped in the spec's `=?base64?...?=` form.
 */
export function encodeHeaderValue(value: string): string {
  const plainSafe = /^[\x21-\x7e][\x20-\x7e]*$/.test(value) && !/\s$/.test(value)
  const looksEncoded = value.startsWith('=?base64?') && value.endsWith('?=')
  if (plainSafe && !looksEncoded) return value
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/**
 * The transport headers mirrored from a request body. The protocol version is
 * the caller's to have supplied; `undefined` means the body carries none and the
 * request should not be sent (see `runBridge`).
 */
export function transportHeaders(message: Record<string, unknown>): Record<string, string> | undefined {
  const params = isObject(message.params) ? message.params : {}
  const meta = isObject(params._meta) ? params._meta : {}
  const version = meta[META_PROTOCOL_VERSION]
  if (typeof version !== 'string' || version.length === 0) return undefined

  const method = message.method as string
  const headers: Record<string, string> = {
    [HEADER.PROTOCOL_VERSION]: version,
    [HEADER.METHOD]: method,
  }
  const field = NAME_FIELD[method]
  if (field) {
    const name = params[field]
    if (typeof name === 'string') headers[HEADER.NAME] = encodeHeaderValue(name)
  }
  return headers
}

export interface ForwardRequest {
  body: string
  headers: Record<string, string>
  signal: AbortSignal
}

export interface ForwardResponse {
  status: number
  contentType: string
  body: string
  retryAfter?: string
}

/** How the bridge sends a request. Injected so tests can run without a socket. */
export type Forwarder = (req: ForwardRequest) => Promise<ForwardResponse>

/** The production forwarder: one POST to `${baseUrl}/mcp` with the platform credential. */
export function httpForwarder(opts: {baseUrl: string; token: string; timeoutMs?: number}): Forwarder {
  const url = new URL('/mcp', opts.baseUrl)
  return async ({body, headers, signal}) => {
    // Whichever fires first: the client's cancellation or the deadline. The
    // deadline covers the body read too, like fetchWithTimeout's does.
    const deadline = AbortSignal.timeout(opts.timeoutMs ?? MCP_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          ...headers,
          accept: 'application/json, text/event-stream',
          authorization: `Key ${opts.token}`,
          'content-type': 'application/json',
        },
        signal: anySignal(signal, deadline),
      })
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body: await res.text(),
        retryAfter: res.headers.get('retry-after') ?? undefined,
      }
    } catch (err) {
      // Node 18 rejects a body read cut off by the deadline with a plain
      // AbortError rather than the signal's TimeoutError, so the deadline is
      // asked directly instead of the error's name being trusted.
      if (deadline.aborted && !signal.aborted) throw new BridgeTimeoutError()
      throw err
    }
  }
}

/** The deadline fired; the one abort that is the bridge's rather than the client's. */
export class BridgeTimeoutError extends Error {
  constructor() {
    super('The Tediware server did not answer in time.')
    this.name = 'TimeoutError'
  }
}

export interface BridgeOptions {
  input: Readable
  output: Writable
  /** Diagnostics only; never MCP messages. */
  stderr?: Writable
  forward: Forwarder
}

/**
 * Run the bridge until `input` ends and every in-flight request has answered.
 * Requests are forwarded concurrently and answered in whatever order the server
 * replies; the client correlates by id, as the stdio binding requires.
 */
export async function runBridge(opts: BridgeOptions): Promise<void> {
  const pending = new Set<Promise<void>>()
  const inFlight = new Map<string, AbortController>()
  const idKey = (id: JsonRpcId) => `${typeof id}:${String(id)}`

  const write = (message: unknown) => {
    // JSON.stringify never emits a raw newline, which is what keeps one message
    // to one line.
    opts.output.write(JSON.stringify(message) + '\n')
  }
  const note = (text: string) => opts.stderr?.write(`tedi mcp serve: ${text}\n`)
  const writeError = (id: JsonRpcId, code: number, message: string, data?: unknown) => {
    write({jsonrpc: '2.0', id, error: data === undefined ? {code, message} : {code, message, data}})
  }

  const handleLine = async (line: string): Promise<void> => {
    if (line.trim() === '') return

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      writeError(null, RPC.PARSE_ERROR, 'Request body is not valid JSON.')
      return
    }

    if (!isObject(parsed) || parsed.jsonrpc !== '2.0') {
      writeError(null, RPC.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 message object.')
      return
    }
    const message = parsed

    // A client never sends responses on this transport; one that arrives is
    // dropped rather than forwarded to a server that would refuse it anyway.
    if (typeof message.method !== 'string') {
      if ('result' in message || 'error' in message) return
      writeError(null, RPC.INVALID_REQUEST, 'Expected a JSON-RPC request with a string method.')
      return
    }

    const id = message.id
    if (!(id === undefined || id === null || typeof id === 'string' || typeof id === 'number')) {
      writeError(null, RPC.INVALID_REQUEST, 'A JSON-RPC id must be a string, a number, or null.')
      return
    }

    // No id: a notification. The only one the core protocol sends client to
    // server is notifications/cancelled, and it means something here, not on
    // the server: the bridge drops the connection for that request and writes
    // nothing further for it. Any other notification is dropped, because a
    // notification must not be answered and the server would answer it with a
    // refusal.
    if (id === undefined || id === null) {
      if (message.method === 'notifications/cancelled') {
        const requestId = isObject(message.params) ? message.params.requestId : undefined
        if (typeof requestId === 'string' || typeof requestId === 'number') inFlight.get(idKey(requestId))?.abort()
      } else {
        note(`dropped notification ${message.method}`)
      }
      return
    }

    const nameField = NAME_FIELD[message.method]
    if (nameField && !(isObject(message.params) && typeof message.params[nameField] === 'string')) {
      // Sent as-is this would earn the server's "Mcp-Name header is required",
      // which is the HTTP binding talking about a header this transport does
      // not have. The request is simply missing its name.
      writeError(id, RPC.INVALID_PARAMS, `${message.method} requires a string params.${nameField}.`)
      return
    }

    const headers = transportHeaders(message)
    if (!headers) {
      // The server would call this a header mismatch (-32020), which is the
      // HTTP binding talking. On stdio the accurate statement is that the
      // request named no protocol version; naming the supported one is what
      // the spec asks of a modern-only server, since a legacy client's
      // initialize has no fall-forward path and this may be its only clue.
      writeError(id, RPC.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
        supported: [MCP_PROTOCOL_VERSION],
        requested: null,
      })
      return
    }

    const controller = new AbortController()
    const key = idKey(id)
    inFlight.set(key, controller)
    try {
      const res = await opts.forward({body: line, headers, signal: controller.signal})
      relay(id, res)
    } catch (err) {
      if (controller.signal.aborted) return
      const timedOut = err instanceof BridgeTimeoutError || (err as {name?: string}).name === 'TimeoutError'
      writeError(
        id,
        RPC.UPSTREAM_UNAVAILABLE,
        timedOut ? 'The Tediware server did not answer in time.' : 'The Tediware server could not be reached.',
        {reason: timedOut ? 'timeout' : 'unreachable', detail: (err as Error).message},
      )
    } finally {
      inFlight.delete(key)
    }
  }

  /**
   * Write the server's answer. A JSON-RPC body passes through as-is whatever
   * the status, because the server puts its refusals in one (401, 403, 400,
   * 404 all carry a JSON-RPC error). Only a body that is not JSON-RPC gets a
   * message authored here.
   */
  const relay = (id: JsonRpcId, res: ForwardResponse) => {
    if (res.contentType.startsWith('text/event-stream')) {
      let answered = false
      for (const event of sseMessages(res.body)) {
        if (event.id === id) answered = true
        write(event)
      }
      if (!answered) {
        writeError(id, RPC.UPSTREAM_UNAVAILABLE, 'The Tediware server closed the stream without answering.', {
          reason: 'upstream_error',
          status: res.status,
        })
      }
      return
    }

    const parsed = parseJsonRpc(res.body)
    if (parsed) {
      // On HTTP the exchange correlates a reply to its request, so the server
      // may refuse with id null before it has read one (an oversized body, for
      // instance). On stdio only the id correlates, and a null would leave the
      // client's request pending forever; the bridge knows which request this
      // was and says so.
      if ('error' in parsed && (parsed.id === null || parsed.id === undefined)) parsed.id = id
      write(parsed)
      return
    }

    if (res.status === 429) {
      const seconds = Number.parseInt(res.retryAfter ?? '', 10)
      const data: Record<string, unknown> = {reason: 'rate_limited'}
      if (Number.isFinite(seconds) && seconds > 0) data.retryAfterSeconds = seconds
      writeError(id, RPC.RATE_LIMITED, 'Rate limit exceeded.', data)
      return
    }

    writeError(id, RPC.UPSTREAM_UNAVAILABLE, `The Tediware server answered HTTP ${res.status} without a JSON-RPC body.`, {
      reason: 'upstream_error',
      status: res.status,
    })
  }

  await new Promise<void>((resolve) => {
    const lines = createInterface({input: opts.input, crlfDelay: Infinity})
    lines.on('line', (line) => {
      const task = handleLine(line).finally(() => pending.delete(task))
      pending.add(task)
    })
    lines.on('close', resolve)
  })

  // stdin closed: the client's graceful-shutdown signal. Let what is in flight
  // finish so no answer is lost, then return so the process exits.
  await Promise.all(pending)
}

function parseJsonRpc(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body)
    return isObject(parsed) && parsed.jsonrpc === '2.0' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The JSON-RPC messages in an SSE body. The platform answers with plain JSON
 * today, but the binding lets a server choose per request, so a stream is read
 * rather than refused: each event's `data:` lines joined make one message.
 */
export function sseMessages(body: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = []
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data === '') continue
    const parsed = parseJsonRpc(data)
    if (parsed) messages.push(parsed)
  }
  return messages
}

/**
 * `AbortSignal.any` for Node 18, which the engines field still admits. The
 * combined signal carries the first reason through, so a timeout still reads as
 * a TimeoutError to the caller.
 */
function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {once: true})
  }
  return controller.signal
}
