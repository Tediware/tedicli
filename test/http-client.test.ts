import assert from 'node:assert/strict'
import {afterEach, describe, it} from 'node:test'

import {HttpApiClient, MAX_INSPECT_BYTES} from '../src/lib/api-client.js'
import {
  AccountUnavailableError,
  EdiTooLargeError,
  InspectionFailedError,
  InvalidApiKeyError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitedError,
  TediError,
  TermsNotAcceptedError,
} from '../src/lib/errors.js'
import {OutputFormat} from '../src/lib/output.js'

const realFetch = globalThis.fetch

interface Captured {
  url: string
  headers: Record<string, string>
  method: string
  /** Request body, for the endpoints that send one. */
  body?: string
}

/** Stub global fetch, recording each request and returning a scripted response. */
function stubFetch(handler: (req: Captured) => {status?: number; body?: string; headers?: Record<string, string>}): {
  calls: Captured[]
} {
  const calls: Captured[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers = (init?.headers ?? {}) as Record<string, string>
    const captured = {
      url,
      headers,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(captured)
    const {status = 200, body = '', headers: resHeaders} = handler(captured)
    return new Response(body, {status, headers: resHeaders})
  }) as typeof fetch
  return {calls}
}

const client = (token?: string) => new HttpApiClient({baseUrl: 'http://localhost:5004', token})
const req = (over: Partial<{release: string; format: OutputFormat; color: boolean}> = {}) => ({
  release: '004010',
  format: 'console' as OutputFormat,
  color: false,
  ...over,
})

describe('HttpApiClient', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('x12Releases', () => {
    it('unwraps the data.releases envelope and maps fields', async () => {
      const {calls} = stubFetch(() => ({
        body: JSON.stringify({
          data: {
            releases: [
              {id: 10, code: '005010', name: null, hipaa: true, published_at: null},
              {id: 9, code: '004010', name: 'Release 004010', hipaa: false, published_at: null},
            ],
          },
        }),
      }))
      const releases = await client('sk-test').x12Releases()
      assert.deepEqual(releases, [
        {code: '005010', name: null, hipaa: true},
        {code: '004010', name: 'Release 004010', hipaa: false},
      ])
      assert.equal(calls[0].url, 'http://localhost:5004/api/x12/releases')
      assert.equal(calls[0].headers.authorization, 'Key sk-test')
    })

    it('returns an empty list when the envelope has no releases', async () => {
      stubFetch(() => ({body: JSON.stringify({data: {}})}))
      assert.deepEqual(await client('sk-test').x12Releases(), [])
    })

    it('omits the auth header when no token is set (releases is reachable without a key)', async () => {
      const {calls} = stubFetch(() => ({body: JSON.stringify({data: {releases: []}})}))
      await client(undefined).x12Releases()
      assert.equal(calls[0].headers.authorization, undefined)
    })
  })

  describe('reference requests', () => {
    it('builds the release-scoped download path with an explicit variant', async () => {
      const {calls} = stubFetch(() => ({body: 'Segment N1\nRelease: 004010'}))
      const doc = await client('sk-test').x12Segment('N1', req({format: 'console'}))
      assert.equal(calls[0].url, 'http://localhost:5004/api/x12/004010/segments/N1/download?variant=console')
      assert.equal(calls[0].headers.authorization, 'Key sk-test')
      assert.equal(doc.body, 'Segment N1\nRelease: 004010')
      assert.equal(doc.release, '004010')
    })

    it('adds color=true only when color is requested', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await client('sk-test').x12Segment('N1', req({color: true}))
      assert.match(calls[0].url, /[?&]color=true/)
    })

    it('uses the elements and transaction_sets resources for the other lookups', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      const c = client('sk-test')
      await c.x12Element('235', req({format: 'markdown'}))
      await c.x12Transaction('856', req())
      assert.match(calls[0].url, /\/api\/x12\/004010\/elements\/235\/download\?variant=markdown$/)
      assert.match(calls[1].url, /\/api\/x12\/004010\/transaction_sets\/856\/download\?variant=console$/)
    })

    it('honors the requested release in the path', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await client('sk-test').x12Segment('N1', req({release: '005010'}))
      assert.match(calls[0].url, /\/api\/x12\/005010\/segments\/N1\//)
    })

    it('fails fast without contacting the server when no token is stored', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await assert.rejects(client(undefined).x12Segment('N1', req()), NotAuthenticatedError)
      assert.equal(calls.length, 0)
    })
  })

  describe('error mapping', () => {
    it('maps a 401 with a key to InvalidApiKeyError, echoing the base URL', async () => {
      stubFetch(() => ({status: 401, body: JSON.stringify({error: 'Invalid API key'})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof InvalidApiKeyError)
        assert.match(err.message, /rejected by the server at http:\/\/localhost:5004/)
        return true
      })
    })

    it('maps a 401 with no key to NotAuthenticatedError', async () => {
      // `releases` is the only request the client sends without a key; if that ever
      // 401s, it's a genuine "not signed in", not a rejected key.
      stubFetch(() => ({status: 401, body: JSON.stringify({error: 'Not authenticated'})}))
      await assert.rejects(client(undefined).x12Releases(), NotAuthenticatedError)
    })

    it('maps a 403 about terms to TermsNotAcceptedError', async () => {
      stubFetch(() => ({status: 403, body: JSON.stringify({error: 'Service terms must be accepted'})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), TermsNotAcceptedError)
    })

    it('maps a non-terms 403 to AccountUnavailableError', async () => {
      stubFetch(() => ({status: 403, body: JSON.stringify({error: 'Account unavailable'})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), AccountUnavailableError)
    })

    it('maps 404 to a contextual NotFoundError', async () => {
      stubFetch(() => ({status: 404, body: JSON.stringify({error: 'Record not found'})}))
      await assert.rejects(client('sk-test').x12Segment('ZZ', req({release: '004010'})), (err: unknown) => {
        assert.ok(err instanceof NotFoundError)
        assert.match(err.message, /No segment 'ZZ' in release 004010/)
        return true
      })
    })

    it('maps 429 to RateLimitedError and surfaces Retry-After', async () => {
      stubFetch(() => ({
        status: 429,
        headers: {'retry-after': '42'},
        body: JSON.stringify({error: {message: 'slow down', code: 'rate_limited'}}),
      }))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof RateLimitedError)
        assert.equal(err.retryAfterSeconds, 42)
        assert.match(err.message, /42s/)
        return true
      })
    })

    it('maps a 404 without resource context to a generic not-found (releases path)', async () => {
      stubFetch(() => ({status: 404, body: ''}))
      await assert.rejects(client('sk-test').x12Releases(), /Record not found/)
    })

    it('maps an unexpected status to a generic error carrying the server message', async () => {
      stubFetch(() => ({status: 500, body: JSON.stringify({error: 'boom'})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /failed \(500/)
        assert.match(err.message, /boom/)
        return true
      })
    })

    it('falls back to a generic message when the error body is not JSON', async () => {
      stubFetch(() => ({status: 502, body: '<html>bad gateway</html>'}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /failed \(502/)
        assert.doesNotMatch(err.message, /html/)
        return true
      })
    })
  })

  describe('ediInspect', () => {
    const INTERCHANGE = 'ISA*00*...~GS*HC*...~'

    it('posts the document as JSON with an explicit variant', async () => {
      const {calls} = stubFetch(() => ({body: 'INSPECTION REPORT'}))
      const report = await client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false})

      assert.equal(calls[0].url, 'http://localhost:5004/api/edi/inspect')
      assert.equal(calls[0].method, 'POST')
      assert.equal(calls[0].headers.authorization, 'Key sk-test')
      assert.equal(calls[0].headers['content-type'], 'application/json')
      assert.deepEqual(JSON.parse(calls[0].body!), {edi_content: INTERCHANGE, variant: 'console'})
      assert.deepEqual(report, {format: 'console', body: 'INSPECTION REPORT'})
    })

    it('adds color only when requested, and honors the markdown variant', async () => {
      const {calls} = stubFetch(() => ({body: '# Inspection'}))
      const c = client('sk-test')
      await c.ediInspect(INTERCHANGE, {format: 'console', color: true})
      await c.ediInspect(INTERCHANGE, {format: 'markdown', color: false})

      assert.equal(JSON.parse(calls[0].body!).color, true)
      assert.equal(JSON.parse(calls[1].body!).color, undefined)
      assert.equal(JSON.parse(calls[1].body!).variant, 'markdown')
    })

    it('fails fast without contacting the server when no token is stored', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await assert.rejects(
        client(undefined).ediInspect(INTERCHANGE, {format: 'console', color: false}),
        NotAuthenticatedError,
      )
      assert.equal(calls.length, 0)
    })

    it('rejects an oversized interchange before uploading it', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      const huge = 'A'.repeat(MAX_INSPECT_BYTES + 1)
      await assert.rejects(client('sk-test').ediInspect(huge, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof EdiTooLargeError)
        assert.match(err.message, /accepts up to 256 KB/)
        return true
      })
      assert.equal(calls.length, 0)
    })

    it('measures the size in bytes, not characters', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      // Just inside the cap by character count, over it once encoded as UTF-8.
      const multibyte = 'é'.repeat(MAX_INSPECT_BYTES / 2 + 1)
      await assert.rejects(client('sk-test').ediInspect(multibyte, {format: 'console', color: false}), EdiTooLargeError)
      assert.equal(calls.length, 0)
    })

    // The server answers 422 today; 400 and 413 must land identically so a
    // reclassified rejection still reads as a document problem.
    for (const status of [400, 413, 422]) {
      it(`surfaces the server's diagnosis on a ${status}`, async () => {
        stubFetch(() => ({status, body: JSON.stringify({error: 'Interchange ends without an IEA segment.'})}))
        await assert.rejects(
          client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
          (err: unknown) => {
            assert.ok(err instanceof InspectionFailedError)
            assert.equal(err.message, 'Interchange ends without an IEA segment.')
            return true
          },
        )
      })
    }

    it('falls back to a generic message when the rejection carries none', async () => {
      stubFetch(() => ({status: 422, body: ''}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof InspectionFailedError)
        assert.match(err.message, /could not inspect this interchange/)
        return true
      })
    })

    it('reads a 404 as a missing endpoint, not a missing record', async () => {
      // Nothing was looked up by id here, so a 404 means api.baseUrl points at a
      // server without the route — "Record not found" would answer a question
      // nobody asked, and would hide the real problem.
      stubFetch(() => ({status: 404, body: ''}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /no EDI inspection endpoint \(HTTP 404\)/)
        assert.match(err.message, /http:\/\/localhost:5004/)
        assert.ok(err.suggestions.some((s) => s.includes('api.baseUrl')))
        return true
      })
    })

    it('still maps the shared credential and throttle statuses', async () => {
      stubFetch(() => ({status: 401, body: JSON.stringify({error: 'Invalid API key'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        InvalidApiKeyError,
      )

      stubFetch(() => ({status: 429, headers: {'retry-after': '7'}, body: '{}'}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof RateLimitedError)
        assert.equal(err.retryAfterSeconds, 7)
        return true
      })
    })
  })

  describe('reference lookups do not borrow the inspect error mapping', () => {
    it('treats a 400 as an unexpected failure, keeping the status visible', async () => {
      // The CLI controls every reference parameter, so a 400 there is a bug, not
      // something the user can fix — it must not render as an inspection failure.
      stubFetch(() => ({status: 400, body: JSON.stringify({error: "Unknown variant 'xml'."})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /failed \(400/)
        assert.match(err.message, /Unknown variant/)
        return true
      })
    })
  })

  describe('endpoints that do not exist yet', () => {
    it('whoami throws a not-available error', async () => {
      await assert.rejects(client('sk-test').whoami(), /identity endpoint is not available/i)
    })
  })
})
