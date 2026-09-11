import assert from 'node:assert/strict'
import {createServer, IncomingMessage, Server} from 'node:http'
import {AddressInfo} from 'node:net'
import {PassThrough} from 'node:stream'
import {after, before, describe, it} from 'node:test'

import {
  encodeHeaderValue,
  ForwardRequest,
  ForwardResponse,
  httpForwarder,
  runBridge,
  RPC,
  sseMessages,
  transportHeaders,
  withProtocolVersion,
} from '../src/lib/mcp-bridge.js'

const META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28'}

const request = (id: number | string, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params: {...params, _meta: META},
})

const okResponse = (body: unknown, over: Partial<ForwardResponse> = {}): ForwardResponse => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
  ...over,
})

/**
 * Drive the bridge with a scripted forwarder: feed `lines` on stdin, close it,
 * and return every message written to stdout, parsed.
 */
async function drive(
  lines: string[],
  forward: (req: ForwardRequest) => Promise<ForwardResponse>,
): Promise<{out: Record<string, unknown>[]; err: string; calls: ForwardRequest[]}> {
  const input = new PassThrough()
  const output = new PassThrough()
  const stderr = new PassThrough()
  const calls: ForwardRequest[] = []
  let stdout = ''
  let errText = ''
  output.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  stderr.on('data', (chunk: Buffer) => (errText += chunk.toString()))

  const done = runBridge({
    input,
    output,
    stderr,
    forward: (req) => {
      calls.push(req)
      return forward(req)
    },
  })
  for (const line of lines) input.write(line + '\n')
  input.end()
  await done

  const out = stdout
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  // Every output line must be a complete JSON-RPC message on its own: the
  // stdio binding's one framing rule.
  assert.equal(stdout === '' || stdout.endsWith('\n'), true)
  return {out, err: errText, calls}
}

describe('encodeHeaderValue', () => {
  it('leaves plain visible-ASCII values alone', () => {
    assert.equal(encodeHeaderValue('x12_segment'), 'x12_segment')
    assert.equal(encodeHeaderValue('file:///a/b.json'), 'file:///a/b.json')
  })

  it('wraps non-ASCII, padded, control-bearing and sentinel-shaped values', () => {
    assert.equal(encodeHeaderValue('Hello, 世界'), '=?base64?SGVsbG8sIOS4lueVjA==?=')
    assert.equal(encodeHeaderValue(' padded '), '=?base64?IHBhZGRlZCA=?=')
    assert.equal(encodeHeaderValue('line1\nline2'), '=?base64?bGluZTEKbGluZTI=?=')
    assert.equal(encodeHeaderValue('=?base64?literal?='), '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=')
  })
})

describe('transportHeaders', () => {
  it('mirrors version and method, and the tool name for tools/call', () => {
    const headers = transportHeaders(request(1, 'tools/call', {name: 'x12_segment', arguments: {}}))
    assert.deepEqual(headers, {
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'x12_segment',
    })
  })

  it('sends no Mcp-Name for methods that carry none', () => {
    const headers = transportHeaders(request(1, 'tools/list'))
    assert.deepEqual(headers, {'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list'})
  })

  it('mirrors params.uri for resources/read', () => {
    const headers = transportHeaders(request(1, 'resources/read', {uri: 'tediware://artifact/1'}))
    assert.equal(headers?.['Mcp-Name'], 'tediware://artifact/1')
  })

  it('is undefined when the body names no protocol version', () => {
    assert.equal(transportHeaders({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}), undefined)
  })
})

describe('withProtocolVersion', () => {
  it('adds _meta without disturbing the rest of params', () => {
    const stamped = withProtocolVersion({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'x', arguments: {a: 1}}})
    assert.deepEqual(stamped.params, {name: 'x', arguments: {a: 1}, _meta: {'io.modelcontextprotocol/protocolVersion': '2026-07-28'}})
  })

  it('keeps an existing _meta version', () => {
    const message = request(1, 'tools/list')
    assert.equal(withProtocolVersion(message), message)
  })
})

describe('runBridge', () => {
  it('forwards a request body unchanged and relays the reply as one line', async () => {
    const reply = {jsonrpc: '2.0', id: 1, result: {resultType: 'complete', tools: []}}
    const line = JSON.stringify(request(1, 'tools/list'))
    const {out, calls} = await drive([line], async () => okResponse(reply))

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.body, line)
    assert.equal(calls[0]!.headers['Mcp-Method'], 'tools/list')
    assert.deepEqual(out, [reply])
  })

  it('forwards server/discover rather than answering it locally', async () => {
    const reply = {jsonrpc: '2.0', id: 'd', result: {supportedVersions: ['2026-07-28'], instructions: 'from server'}}
    const {out, calls} = await drive([JSON.stringify(request('d', 'server/discover'))], async () => okResponse(reply))
    assert.equal(calls.length, 1)
    assert.deepEqual(out, [reply])
  })

  it('passes a JSON-RPC error body through whatever the HTTP status', async () => {
    const refusal = {jsonrpc: '2.0', id: 7, error: {code: -32000, message: 'Invalid API key.', data: {reason: 'unauthorized'}}}
    const {out} = await drive([JSON.stringify(request(7, 'tools/list'))], async () => okResponse(refusal, {status: 401}))
    assert.deepEqual(out, [refusal])
  })

  it('turns a 429 into a JSON-RPC error carrying Retry-After', async () => {
    const {out} = await drive([JSON.stringify(request(3, 'tools/call', {name: 'x12_segment'}))], async () => ({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({error: {message: 'Rate limit exceeded. Please try again later.', code: 'rate_limited'}}),
      retryAfter: '60',
    }))
    assert.deepEqual(out, [
      {
        jsonrpc: '2.0',
        id: 3,
        error: {code: RPC.RATE_LIMITED, message: 'Rate limit exceeded.', data: {reason: 'rate_limited', retryAfterSeconds: 60}},
      },
    ])
  })

  it('reports a non-JSON-RPC upstream failure with its status', async () => {
    const {out} = await drive([JSON.stringify(request(4, 'tools/list'))], async () => ({
      status: 502,
      contentType: 'text/html',
      body: '<html>Bad Gateway</html>',
    }))
    const error = out[0]!.error as {code: number; data: {status: number; reason: string}}
    assert.equal(error.code, RPC.UPSTREAM_UNAVAILABLE)
    assert.equal(error.data.status, 502)
    assert.equal(error.data.reason, 'upstream_error')
  })

  it('reports an unreachable server as a JSON-RPC error, not a crash', async () => {
    const {out} = await drive([JSON.stringify(request(5, 'tools/list'))], async () => {
      throw new TypeError('fetch failed')
    })
    const error = out[0]!.error as {code: number; data: {reason: string}}
    assert.equal(error.code, RPC.UPSTREAM_UNAVAILABLE)
    assert.equal(error.data.reason, 'unreachable')
  })

  it('reports a timeout distinctly', async () => {
    const {out} = await drive([JSON.stringify(request(6, 'tools/list'))], async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })
    const error = out[0]!.error as {data: {reason: string}}
    assert.equal(error.data.reason, 'timeout')
  })

  describe('legacy-era shim', () => {
    it('answers initialize locally, echoing the requested version, and notes it once on stderr', async () => {
      const legacy = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'claude-code', version: '2.1.0'}}}
      const {out, err, calls} = await drive([JSON.stringify(legacy), JSON.stringify({...legacy, id: 2})], async () => okResponse({}))
      assert.equal(calls.length, 0)
      assert.deepEqual(out[0], {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {tools: {}, resources: {}, prompts: {}},
          serverInfo: {name: 'tediware', version: 'unknown'},
        },
      })
      assert.equal(out.length, 2)
      assert.equal(err.match(/client requested protocol 2025-11-25/g)?.length, 1)
    })

    it('reports the CLI version as the server version', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      let stdout = ''
      output.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      const done = runBridge({input, output, forward: async () => okResponse({}), version: '0.4.0'})
      input.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}) + '\n')
      input.end()
      await done
      assert.equal((JSON.parse(stdout).result as {serverInfo: {version: string}}).serverInfo.version, '0.4.0')
    })

    it('swallows notifications/initialized silently and answers ping', async () => {
      const {out, err, calls} = await drive(
        [
          JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}),
          JSON.stringify({jsonrpc: '2.0', id: 'p', method: 'ping'}),
        ],
        async () => okResponse({}),
      )
      assert.equal(calls.length, 0)
      assert.deepEqual(out, [{jsonrpc: '2.0', id: 'p', result: {}}])
      assert.doesNotMatch(err, /dropped notification/)
    })

    it('stamps the platform protocol version into _meta on a version-less request and mirrors the header', async () => {
      const legacy = {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'x12_segment', arguments: {code: 'N1'}}}
      const reply = {jsonrpc: '2.0', id: 3, result: {content: []}}
      const {out, calls} = await drive([JSON.stringify(legacy)], async () => okResponse(reply))
      assert.equal(calls.length, 1)
      const sent = JSON.parse(calls[0]!.body) as {params: {_meta: Record<string, string>; arguments: unknown}}
      assert.equal(sent.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28')
      assert.deepEqual(sent.params.arguments, {code: 'N1'})
      assert.equal(calls[0]!.headers['MCP-Protocol-Version'], '2026-07-28')
      assert.equal(calls[0]!.headers['Mcp-Name'], 'x12_segment')
      assert.deepEqual(out, [reply])
    })

    it('leaves a request that already names the platform version untouched', async () => {
      const line = JSON.stringify(request(4, 'tools/list'))
      const {calls} = await drive([line], async () => okResponse({jsonrpc: '2.0', id: 4, result: {}}))
      assert.equal(calls[0]!.body, line)
    })

    it('refuses a request naming a different version, with the supported list, without forwarding', async () => {
      const foreign = {jsonrpc: '2.0', id: 5, method: 'tools/list', params: {_meta: {'io.modelcontextprotocol/protocolVersion': '2027-01-01'}}}
      const init = {jsonrpc: '2.0', id: 6, method: 'initialize', params: {protocolVersion: '2027-01-01', _meta: {'io.modelcontextprotocol/protocolVersion': '2027-01-01'}}}
      const {out, calls} = await drive([JSON.stringify(foreign), JSON.stringify(init)], async () => okResponse({}))
      assert.equal(calls.length, 0)
      assert.deepEqual(out, [
        {jsonrpc: '2.0', id: 5, error: {code: RPC.UNSUPPORTED_PROTOCOL_VERSION, message: 'Unsupported protocol version', data: {supported: ['2026-07-28'], requested: '2027-01-01'}}},
        {jsonrpc: '2.0', id: 6, error: {code: RPC.UNSUPPORTED_PROTOCOL_VERSION, message: 'Unsupported protocol version', data: {supported: ['2026-07-28'], requested: '2027-01-01'}}},
      ])
    })
  })

  it('drains in-flight requests on shutdown, which is what the signal handlers ask for', {timeout: 5000}, async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const input = new PassThrough()
    const output = new PassThrough()
    const shutdown = new AbortController()
    let stdout = ''
    output.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    const done = runBridge({
      input,
      output,
      shutdown: shutdown.signal,
      forward: async () => {
        await gate
        return okResponse({jsonrpc: '2.0', id: 'slow', result: {ok: true}})
      },
    })
    input.write(JSON.stringify(request('slow', 'tools/list')) + '\n')
    await new Promise((r) => setImmediate(r))
    shutdown.abort()
    setTimeout(release, 20)
    await done
    assert.deepEqual(JSON.parse(stdout), {jsonrpc: '2.0', id: 'slow', result: {ok: true}})
  })

  it('answers malformed input with parse and invalid-request errors on id null', async () => {
    const {out, calls} = await drive(['not json', '[1,2]', '{"jsonrpc":"2.0","id":1}'], async () => okResponse({}))
    assert.equal(calls.length, 0)
    assert.deepEqual(
      out.map((m) => [m.id, (m.error as {code: number}).code]),
      [
        [null, RPC.PARSE_ERROR],
        [null, RPC.INVALID_REQUEST],
        [null, RPC.INVALID_REQUEST],
      ],
    )
  })

  it('drops other notifications and client responses without answering or forwarding', async () => {
    const {out, err, calls} = await drive(
      [
        JSON.stringify({jsonrpc: '2.0', method: 'notifications/roots/list_changed'}),
        JSON.stringify({jsonrpc: '2.0', id: 9, result: {}}),
        '',
      ],
      async () => okResponse({}),
    )
    assert.equal(calls.length, 0)
    assert.deepEqual(out, [])
    assert.match(err, /dropped notification notifications\/roots\/list_changed/)
  })

  it('aborts an in-flight request on notifications/cancelled and writes nothing for it', {timeout: 5000}, async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const calls: ForwardRequest[] = []
    const forward = (req: ForwardRequest) =>
      new Promise<ForwardResponse>((resolve, reject) => {
        calls.push(req)
        req.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true})
        gate.then(() => resolve(okResponse({jsonrpc: '2.0', id: 'slow', result: {}})))
      })

    const input = new PassThrough()
    const output = new PassThrough()
    let stdout = ''
    output.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    const done = runBridge({input, output, forward})

    input.write(JSON.stringify(request('slow', 'tools/call', {name: 'edi_inspect'})) + '\n')
    // Let the forward begin before cancelling it.
    await new Promise((r) => setImmediate(r))
    input.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 'slow'}}) + '\n')
    input.end()
    await done
    release()

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.signal.aborted, true)
    assert.equal(stdout, '')
  })

  it('re-keys a server error that arrived with id null onto the request that caused it', async () => {
    // The server refuses an oversized body before reading its id.
    const refusal = {jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Request body exceeds 5MB.'}}
    const {out} = await drive([JSON.stringify(request(13, 'tools/call', {name: 'edi_inspect'}))], async () =>
      okResponse(refusal, {status: 413}),
    )
    assert.deepEqual(out, [{...refusal, id: 13}])
  })

  it('answers a name-bearing method with no string name locally with -32602', async () => {
    const {out, calls} = await drive(
      [
        JSON.stringify(request(14, 'tools/call', {arguments: {}})),
        JSON.stringify(request(15, 'resources/read', {uri: 7})),
      ],
      async () => okResponse({}),
    )
    assert.equal(calls.length, 0)
    assert.deepEqual(
      out.map((m) => [m.id, (m.error as {code: number}).code]),
      [
        [14, RPC.INVALID_PARAMS],
        [15, RPC.INVALID_PARAMS],
      ],
    )
  })

  it('reports an SSE stream that closed without answering the request', async () => {
    const {out} = await drive([JSON.stringify(request(16, 'tools/call', {name: 'edi_inspect'}))], async () => ({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n',
    }))
    assert.equal(out.length, 2)
    assert.equal(out[1]!.id, 16)
    assert.equal((out[1]!.error as {code: number}).code, RPC.UPSTREAM_UNAVAILABLE)
  })

  it('runs requests concurrently and lets replies arrive out of order', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => (releaseFirst = resolve))
    const {out} = await drive(
      [JSON.stringify(request(1, 'tools/list')), JSON.stringify(request(2, 'tools/list'))],
      async (req) => {
        const {id} = JSON.parse(req.body) as {id: number}
        if (id === 1) await first
        else queueMicrotask(releaseFirst)
        return okResponse({jsonrpc: '2.0', id, result: {}})
      },
    )
    assert.deepEqual(
      out.map((m) => m.id),
      [2, 1],
    )
  })

  it('writes each message of an SSE reply as its own line', async () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
      'data: {"jsonrpc":"2.0",\ndata: "id":1,"result":{}}\n\n'
    const {out} = await drive([JSON.stringify(request(1, 'tools/call', {name: 'edi_inspect'}))], async () => ({
      status: 200,
      contentType: 'text/event-stream',
      body,
    }))
    assert.deepEqual(out, [
      {jsonrpc: '2.0', method: 'notifications/progress', params: {}},
      {jsonrpc: '2.0', id: 1, result: {}},
    ])
  })
})

describe('sseMessages', () => {
  it('ignores comments and non-JSON-RPC data', () => {
    assert.deepEqual(sseMessages(': keep-alive\n\ndata: nope\n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'), [
      {jsonrpc: '2.0', id: 1, result: {}},
    ])
  })
})

describe('httpForwarder', () => {
  let server: Server
  let baseUrl: string
  let seen: {headers: IncomingMessage['headers']; url: string; body: string}[] = []

  before(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        seen.push({headers: req.headers, url: req.url ?? '', body})
        if (body.includes('"never"')) return
        if (body.includes('"stall"')) {
          res.writeHead(200, {'content-type': 'application/json'})
          res.write('{"jsonrpc":"2.0","id":"stall",')
          return
        }
        if (body.includes('"throttle"')) {
          res.writeHead(429, {'content-type': 'application/json', 'retry-after': '30'})
          res.end(JSON.stringify({error: {code: 'rate_limited'}}))
          return
        }
        res.writeHead(200, {'content-type': 'application/json; charset=utf-8'})
        res.end(JSON.stringify({jsonrpc: '2.0', id: JSON.parse(body).id, result: {echo: true}}))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  after(() => server.close())

  it('preserves a path on the base URL and sends the User-Agent', async () => {
    seen = []
    const forward = httpForwarder({baseUrl: `${baseUrl}/prefix/`, token: 'sk-test', userAgent: 'tedi/0.0.0 (test)'})
    const line = JSON.stringify(request(10, 'tools/list'))
    await forward({body: line, headers: transportHeaders(JSON.parse(line))!, signal: new AbortController().signal})
    assert.equal(seen[0]!.url, '/prefix/mcp')
    assert.equal(seen[0]!.headers['user-agent'], 'tedi/0.0.0 (test)')
  })

  it('POSTs to /mcp with the credential, Accept, and the mirrored transport headers', async () => {
    seen = []
    const forward = httpForwarder({baseUrl, token: 'sk-test'})
    const line = JSON.stringify(request(11, 'tools/call', {name: 'x12_segment', arguments: {code: 'ISA'}}))
    const res = await forward({body: line, headers: transportHeaders(JSON.parse(line))!, signal: new AbortController().signal})

    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), {jsonrpc: '2.0', id: 11, result: {echo: true}})
    const [req] = seen
    assert.equal(req!.url, '/mcp')
    assert.equal(req!.body, line)
    assert.equal(req!.headers.authorization, 'Key sk-test')
    assert.equal(req!.headers.accept, 'application/json, text/event-stream')
    assert.equal(req!.headers['content-type'], 'application/json')
    assert.equal(req!.headers['mcp-protocol-version'], '2026-07-28')
    assert.equal(req!.headers['mcp-method'], 'tools/call')
    assert.equal(req!.headers['mcp-name'], 'x12_segment')
  })

  it('surfaces status and Retry-After so the bridge can author the 429', async () => {
    const forward = httpForwarder({baseUrl, token: 'sk-test'})
    const line = JSON.stringify(request('throttle', 'tools/list'))
    const res = await forward({body: line, headers: transportHeaders(JSON.parse(line))!, signal: new AbortController().signal})
    assert.equal(res.status, 429)
    assert.equal(res.retryAfter, '30')
  })

  const forwardWithDeadline = (id: string, timeoutMs: number) => {
    const line = JSON.stringify(request(id, 'tools/list'))
    return httpForwarder({baseUrl, token: 'sk-test', timeoutMs})({
      body: line,
      headers: transportHeaders(JSON.parse(line))!,
      signal: new AbortController().signal,
    })
  }

  it('classifies a server that never answers as a timeout', async () => {
    await assert.rejects(forwardWithDeadline('never', 100), (err: Error) => err.name === 'TimeoutError')
  })

  it('classifies a body that stalls after the headers as a timeout, on every Node version', async () => {
    await assert.rejects(forwardWithDeadline('stall', 100), (err: Error) => err.name === 'TimeoutError')
  })

  it('reports a client-side abort as an abort, not a timeout', async () => {
    const controller = new AbortController()
    const line = JSON.stringify(request('never', 'tools/list'))
    const pending = httpForwarder({baseUrl, token: 'sk-test', timeoutMs: 5000})({
      body: line,
      headers: transportHeaders(JSON.parse(line))!,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, (err: Error) => err.name !== 'TimeoutError')
  })

  it('round-trips through the bridge end to end', async () => {
    const {out} = await drive([JSON.stringify(request(12, 'tools/list'))], httpForwarder({baseUrl, token: 'sk-test'}))
    assert.deepEqual(out, [{jsonrpc: '2.0', id: 12, result: {echo: true}}])
  })
})
