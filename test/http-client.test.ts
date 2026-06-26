import assert from 'node:assert/strict'
import {afterEach, describe, it} from 'node:test'

import {HttpApiClient} from '../src/lib/api-client.js'
import {
  AccountUnavailableError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitedError,
  TermsNotAcceptedError,
} from '../src/lib/errors.js'
import {OutputFormat} from '../src/lib/output.js'

const realFetch = globalThis.fetch

interface Captured {
  url: string
  headers: Record<string, string>
}

/** Stub global fetch, recording each request and returning a scripted response. */
function stubFetch(handler: (req: Captured) => {status?: number; body?: string; headers?: Record<string, string>}): {
  calls: Captured[]
} {
  const calls: Captured[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers = (init?.headers ?? {}) as Record<string, string>
    const captured = {url, headers}
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
    it('maps 401 to NotAuthenticatedError', async () => {
      stubFetch(() => ({status: 401, body: JSON.stringify({error: 'Invalid API key'})}))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), NotAuthenticatedError)
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

  describe('endpoints that do not exist yet', () => {
    it('whoami throws a not-available error', async () => {
      await assert.rejects(client('sk-test').whoami(), /identity endpoint is not available/i)
    })
  })
})
