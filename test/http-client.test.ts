import assert from 'node:assert/strict'
import {afterEach, describe, it} from 'node:test'

import {CodeLimit, HttpApiClient, MAX_INSPECT_BYTES, retryAfterSeconds} from '../src/lib/api-client.js'
import {
  AccountUnavailableError,
  EdiTooLargeError,
  EXIT_DEFECT,
  EXIT_UNUSABLE,
  InspectionUnavailableError,
  InvalidApiKeyError,
  NoSuchEndpointError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitedError,
  TediError,
  TermsNotAcceptedError,
  UnknownReleaseError,
  UnreadableDocumentError,
  UnsupportedReleaseError,
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
const req = (over: Partial<{release: string; format: OutputFormat; color: boolean; codeLimit: CodeLimit}> = {}) => ({
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
      // The wire shape is the shape: `--json` prints this unchanged.
      assert.deepEqual(releases, {
        data: {
          releases: [
            {id: 10, code: '005010', name: null, hipaa: true, published_at: null},
            {id: 9, code: '004010', name: 'Release 004010', hipaa: false, published_at: null},
          ],
        },
      })
      assert.equal(calls[0].url, 'http://localhost:5004/api/x12/releases')
      assert.equal(calls[0].headers.authorization, 'Key sk-test')
    })

    it('treats an envelope with no release list as a contract violation, not an empty list', async () => {
      stubFetch(() => ({body: JSON.stringify({data: {}})}))
      await assert.rejects(client('sk-test').x12Releases(), /answered without a release list/)
    })

    it('treats a non-JSON 2xx as a wrong server, not a crash', async () => {
      stubFetch(() => ({body: '<html>login</html>', headers: {'content-type': 'text/html'}}))
      await assert.rejects(client('sk-test').x12Releases(), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /did not answer with JSON \(text\/html\)/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        return true
      })
    })

    it('sends a User-Agent naming the CLI on every request', async () => {
      const {calls} = stubFetch(() => ({body: JSON.stringify({data: {releases: []}})}))
      await new HttpApiClient({baseUrl: 'http://localhost:5004', token: 'sk', userAgent: 'tedi/0.0.0 (test)'}).x12Releases()
      assert.equal(calls[0].headers['user-agent'], 'tedi/0.0.0 (test)')
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

    it('omits limit entirely when the caller has no opinion', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await client('sk-test').x12Element('673', req())
      // The server owns the default; pinning one here would freeze a number that
      // is the renderer's to change.
      assert.doesNotMatch(calls[0].url, /[?&]limit=/)
    })

    it('sends a numeric code limit', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await client('sk-test').x12Element('673', req({codeLimit: 5}))
      assert.match(calls[0].url, /[?&]limit=5(&|$)/)
    })

    it('sends limit=all for the complete code list', async () => {
      const {calls} = stubFetch(() => ({body: 'x'}))
      await client('sk-test').x12Element('673', req({codeLimit: 'all'}))
      assert.match(calls[0].url, /[?&]limit=all(&|$)/)
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

    it('maps a coded 404 to a contextual NotFoundError', async () => {
      stubFetch(() => ({status: 404, body: JSON.stringify({error: 'Record not found', code: 'not_found'})}))
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

    it('reads an HTTP-date Retry-After against the clock', async () => {
      const at = new Date(Date.now() + 90_000).toUTCString()
      stubFetch(() => ({
        status: 429,
        headers: {'retry-after': at},
        body: JSON.stringify({error: {message: 'slow down', code: 'rate_limited'}}),
      }))
      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof RateLimitedError)
        assert.ok(err.retryAfterSeconds !== undefined && err.retryAfterSeconds >= 89 && err.retryAfterSeconds <= 90)
        return true
      })
    })

    it('maps unknown_release to its own error pointing at the release list', async () => {
      stubFetch(() => ({
        status: 404,
        body: JSON.stringify({error: "Unknown X12 release '999999'. GET /api/x12/releases lists the releases this server carries.", code: 'unknown_release'}),
      }))
      await assert.rejects(client('sk-test').x12Segment('N1', req({release: '999999'})), (err: unknown) => {
        assert.ok(err instanceof UnknownReleaseError)
        assert.match(err.message, /Unknown X12 release '999999'/)
        // Not a verdict on N1, which exists in every release.
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        assert.ok(err.suggestions.some((s) => s.includes('tedi x12 releases')))
        return true
      })
    })

    it('reads a 404 without the plane\'s JSON shape as a missing endpoint', async () => {
      stubFetch(() => ({status: 404, body: '<html>Not Found</html>'}))
      await assert.rejects(client('sk-test').x12Releases(), (err: unknown) => {
        assert.ok(err instanceof NoSuchEndpointError)
        assert.match(err.message, /No such endpoint at http:\/\/localhost:5004/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        return true
      })
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

    it('turns an unreachable server into an actionable error rather than a raw TypeError', async () => {
      // Unwrapped, this escapes as `TypeError: fetch failed` — not a TediError,
      // so it reaches the user as a stack trace and exits 1, which is the CLI
      // telling a build the document is bad when it never reached the server.
      globalThis.fetch = (async () => {
        throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'ENOTFOUND'}})
      }) as typeof fetch

      await assert.rejects(client('sk-test').x12Segment('N1', req()), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /Could not reach the Tediware API at http:\/\/localhost:5004 \(ENOTFOUND\)/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        assert.ok(err.suggestions.some((s) => s.includes('api.baseUrl')))
        return true
      })
    })

    it('names a timeout as a timeout', async () => {
      globalThis.fetch = (async () => {
        throw Object.assign(new Error('The operation was aborted'), {name: 'TimeoutError'})
      }) as typeof fetch

      await assert.rejects(
        client('sk-test').ediInspect('ISA*00*...~', {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof TediError)
          assert.match(err.message, /did not respond in time/)
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          return true
        },
      )
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
      assert.equal(report.format, 'console')
      assert.equal(report.body, 'INSPECTION REPORT')
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

    it('reads the findings summary out of the response headers', async () => {
      stubFetch(() => ({
        body: 'INSPECTION REPORT',
        headers: {
          'x-edi-findings-errors': '3',
          'x-edi-findings-notices': '1',
          'x-edi-inspection-complete': 'true',
        },
      }))
      const report = await client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false})
      assert.deepEqual(report.findings, {errors: 3, notices: 1, complete: true})
    })

    it('treats a missing summary as unknown rather than as a clean bill of health', async () => {
      stubFetch(() => ({body: 'INSPECTION REPORT'}))
      const report = await client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false})
      assert.equal(report.findings, undefined)
      assert.equal(report.body, 'INSPECTION REPORT')
    })

    it('treats a partial or unreadable summary as unknown', async () => {
      // Half a summary tells us nothing; reading the half that arrived as the
      // whole truth is how a document nobody checked passes a build.
      for (const headers of [
        {'x-edi-findings-errors': '0', 'x-edi-inspection-complete': 'true'},
        {'x-edi-findings-errors': '0', 'x-edi-findings-notices': '0'},
        {'x-edi-findings-errors': '', 'x-edi-findings-notices': '0', 'x-edi-inspection-complete': 'true'},
        {'x-edi-findings-errors': 'lots', 'x-edi-findings-notices': '0', 'x-edi-inspection-complete': 'true'},
        {'x-edi-findings-errors': '-1', 'x-edi-findings-notices': '0', 'x-edi-inspection-complete': 'true'},
        // What a repeated header collapses to once `Headers` joins it.
        {'x-edi-findings-errors': '3, 3', 'x-edi-findings-notices': '0', 'x-edi-inspection-complete': 'true'},
        // Coercible by `Number()`, but not anything this server sends.
        {'x-edi-findings-errors': '1e2', 'x-edi-findings-notices': '0', 'x-edi-inspection-complete': 'true'},
      ]) {
        stubFetch(() => ({body: 'x', headers}))
        const report = await client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false})
        assert.equal(report.findings, undefined, `expected unknown findings for ${JSON.stringify(headers)}`)
      }
    })

    it('only believes an inspection is complete when the header says so exactly', async () => {
      for (const [value, complete] of [
        ['true', true],
        ['TRUE', true],
        ['false', false],
        ['maybe', false],
      ] as const) {
        stubFetch(() => ({
          body: 'x',
          headers: {
            'x-edi-findings-errors': '0',
            'x-edi-findings-notices': '0',
            'x-edi-inspection-complete': value,
          },
        }))
        const report = await client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false})
        assert.equal(report.findings?.complete, complete, `for header value ${value}`)
      }
    })

    it('reads unparseable_document as a verdict on the document', async () => {
      stubFetch(() => ({
        status: 422,
        body: JSON.stringify({error: 'Interchange ends without an IEA segment.', code: 'unparseable_document'}),
      }))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof UnreadableDocumentError)
          assert.equal(err.message, 'Interchange ends without an IEA segment.')
          assert.equal(err.exitCode, EXIT_DEFECT)
          return true
        },
      )
    })

    it('reads unsupported_release as a gap on the server, not a bad document', async () => {
      stubFetch(() => ({
        status: 422,
        body: JSON.stringify({error: 'Unsupported X12 release 007030.', code: 'unsupported_release'}),
      }))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedReleaseError)
          assert.equal(err.message, 'Unsupported X12 release 007030.')
          // The document was read fine; nothing here should fail a build.
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          return true
        },
      )
    })

    it('reads inspection_failed as a fault on the server', async () => {
      stubFetch(() => ({status: 422, body: JSON.stringify({error: 'Something broke.', code: 'inspection_failed'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof InspectionUnavailableError)
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          return true
        },
      )
    })

    it('keys on the code, not the status it arrived with', async () => {
      // The statuses have moved once already; the codes are the stable half.
      stubFetch(() => ({status: 400, body: JSON.stringify({error: 'No ISA.', code: 'unparseable_document'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        UnreadableDocumentError,
      )
    })

    it('names a rejected request as a fault in the CLI, not in the document', async () => {
      stubFetch(() => ({status: 400, body: JSON.stringify({error: "Unknown variant 'xml'.", code: 'invalid_variant'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof TediError)
          assert.ok(!(err instanceof UnreadableDocumentError))
          assert.match(err.message, /invalid_variant/)
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          assert.ok(err.suggestions.some((s) => s.includes('tedi update')))
          return true
        },
      )
    })

    it('explains a 413 as the server cap having moved past this build', async () => {
      stubFetch(() => ({status: 413, body: JSON.stringify({error: 'Too large.', code: 'content_too_large'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof TediError)
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          assert.ok(err.suggestions.some((s) => s.includes('256 KB')))
          return true
        },
      )
    })

    it('falls back to the status when the rejection carries no code', async () => {
      // A 422 has always meant "this could not be read as EDI".
      stubFetch(() => ({status: 422, body: JSON.stringify({error: 'Interchange ends without an IEA segment.'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof UnreadableDocumentError)
          assert.equal(err.exitCode, EXIT_DEFECT)
          return true
        },
      )

      // Anything else says nothing about the document, so it must not exit 1.
      stubFetch(() => ({status: 400, body: JSON.stringify({error: 'Nope.'})}))
      await assert.rejects(
        client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}),
        (err: unknown) => {
          assert.ok(err instanceof TediError)
          assert.ok(!(err instanceof UnreadableDocumentError))
          assert.match(err.message, /HTTP 400.*Nope/)
          assert.equal(err.exitCode, EXIT_UNUSABLE)
          return true
        },
      )
    })

    it('falls back to a generic message when the rejection carries none', async () => {
      stubFetch(() => ({status: 422, body: ''}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof UnreadableDocumentError)
        assert.match(err.message, /could not read this file as an X12 interchange/)
        return true
      })
    })

    it('reads a JSON routing 404 as a server without the endpoint, and an HTML one as a wrong base URL', async () => {
      // Nothing was looked up by id here, so a 404 means api.baseUrl points at a
      // server without the route; "Record not found" would answer a question
      // nobody asked, and would hide the real problem.
      stubFetch(() => ({status: 404, body: JSON.stringify({error: 'No such endpoint', code: 'no_route'})}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /no EDI inspection endpoint \(HTTP 404\)/)
        assert.match(err.message, /http:\/\/localhost:5004/)
        return true
      })

      stubFetch(() => ({status: 404, body: '<html>Not Found</html>'}))
      await assert.rejects(client('sk-test').ediInspect(INTERCHANGE, {format: 'console', color: false}), NoSuchEndpointError)
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
    it('names a rejected code limit rather than leaving a bare status', async () => {
      // The user typed this one (via --limit), so it is worth wording, unlike the
      // parameters the CLI builds on its own.
      stubFetch(() => ({status: 400, body: JSON.stringify({error: 'limit must be a positive integer or "all".', code: 'invalid_limit'})}))
      await assert.rejects(client('sk-test').x12Element('673', req({codeLimit: 5})), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /code-list limit/)
        assert.match(err.message, /positive integer/)
        assert.ok(err.suggestions?.some((s) => s.includes('--all')))
        assert.ok(err.suggestions?.some((s) => s.includes('tedi update')))
        return true
      })
    })

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

  describe('platform data plane', () => {
    it('whoami maps the identity response', async () => {
      const {calls} = stubFetch(() => ({
        body: JSON.stringify({
          organization: {id: 'org-1', name: 'Acme EDI'},
          keyScope: 'standard',
          keyLabel: 'CI key',
          serviceTermsAccepted: true,
        }),
      }))
      const id = await client('sk-test-1234').whoami()
      assert.match(calls[0].url, /\/platform\/whoami$/)
      assert.equal(calls[0].headers.authorization, 'Key sk-test-1234')
      // The REST identity shape, unchanged.
      assert.deepEqual(id, {
        organization: {id: 'org-1', name: 'Acme EDI'},
        keyScope: 'standard',
        keyLabel: 'CI key',
        serviceTermsAccepted: true,
      })
    })

    it('whoami treats a missing keyScope or organization as a contract violation, never a default', async () => {
      stubFetch(() => ({body: JSON.stringify({organization: {id: 'org-1', name: 'Acme'}, serviceTermsAccepted: true})}))
      await assert.rejects(client('sk-test').whoami(), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /answered without a key scope/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        return true
      })
      stubFetch(() => ({body: JSON.stringify({keyScope: 'standard'})}))
      await assert.rejects(client('sk-test').whoami(), /answered without an organization/)
    })

    it('whoami degrades to IdentityUnavailableError only on a JSON 404', async () => {
      stubFetch(() => ({status: 404, body: JSON.stringify({error: {message: 'No such endpoint', code: 'no_route'}})}))
      await assert.rejects(client('sk-test').whoami(), /no identity endpoint/i)

      // An HTML 404 is a wrong base path, and must not pass as "older server".
      stubFetch(() => ({status: 404, body: '<html>Not Found</html>'}))
      await assert.rejects(client('sk-test').whoami(), NoSuchEndpointError)
    })

    it('transactionList builds the query and returns the REST envelope', async () => {
      const {calls} = stubFetch(() => ({
        body: JSON.stringify({
          ediTransactions: [{id: 't1'}],
          pagination: {hasMore: true, nextCursor: 'abc'},
        }),
      }))
      const page = await client('sk-test').transactionList({direction: 'outbound', transactionSetIdentifier: '850', partner: 'acme', limit: 5})
      const url = new URL(calls[0].url)
      assert.equal(url.pathname, '/platform/edi_transactions')
      assert.equal(url.searchParams.get('direction'), 'outbound')
      assert.equal(url.searchParams.get('incoming'), null)
      assert.equal(url.searchParams.get('transaction_set_identifier'), '850')
      assert.equal(url.searchParams.get('partner'), 'acme')
      assert.equal(url.searchParams.get('limit'), '5')
      assert.deepEqual(page, {ediTransactions: [{id: 't1'}], pagination: {hasMore: true, nextCursor: 'abc'}})
    })

    it('transactionList sends the warnings filter as true/false, and omits it when unset', async () => {
      const body = JSON.stringify({ediTransactions: [], pagination: {hasMore: false, nextCursor: null}})
      const only = stubFetch(() => ({body}))
      await client('sk-test').transactionList({warnings: true})
      assert.equal(new URL(only.calls[0].url).searchParams.get('warnings'), 'true')

      // false is a filter of its own, not "no filter": it must survive.
      const none = stubFetch(() => ({body}))
      await client('sk-test').transactionList({warnings: false})
      assert.equal(new URL(none.calls[0].url).searchParams.get('warnings'), 'false')

      const unset = stubFetch(() => ({body}))
      await client('sk-test').transactionList({})
      assert.equal(new URL(unset.calls[0].url).searchParams.get('warnings'), null)
    })

    it('words an invalid_parameter 400 as the caller\'s input, exit 2', async () => {
      stubFetch(() => ({status: 400, body: JSON.stringify({error: {message: 'Invalid cursor.', code: 'invalid_parameter'}})}))
      await assert.rejects(client('sk-test').transactionList({cursor: 'garbage'}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /rejected one of the values you passed: Invalid cursor/)
        assert.doesNotMatch(err.message, /request failed/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        assert.equal(err.code, 'invalid_parameter')
        assert.ok(err.suggestions.some((s) => s.includes('--cursor')))
        return true
      })
    })

    it('the list calls send compact=true only when asked', async () => {
      const {calls} = stubFetch((req) => {
        const path = new URL(req.url).pathname
        const key = path.endsWith('edi_transactions') ? 'ediTransactions' : path.endsWith('results') ? 'results' : 'feedEntries'
        return {body: JSON.stringify({[key]: [], pagination: {hasMore: false, nextCursor: null}})}
      })
      await client('sk-test').transactionList({compact: true})
      await client('sk-test').resultList({compact: true})
      await client('sk-test').feedList({compact: true})
      await client('sk-test').transactionList({})
      assert.deepEqual(
        calls.map((c) => new URL(c.url).searchParams.get('compact')),
        ['true', 'true', 'true', null],
      )
    })

    it('resultList passes status and node through', async () => {
      const {calls} = stubFetch(() => ({body: JSON.stringify({results: [], pagination: {hasMore: false, nextCursor: null}})}))
      await client('sk-test').resultList({status: 'error', node: 'EDI to JSON'})
      const url = new URL(calls[0].url)
      assert.equal(url.searchParams.get('status'), 'error')
      assert.equal(url.searchParams.get('node'), 'EDI to JSON')
    })

    it('traceGet reads the trace endpoint and turns a coded 404 into a defect', async () => {
      const {calls} = stubFetch(() => ({body: JSON.stringify({traceGuid: 'g', processing: false, ediTransactions: [], results: [], feedEntries: [], logs: [], artifacts: []})}))
      const trace = await client('sk-test').traceGet('g')
      assert.match(calls[0].url, /\/platform\/traces\/g$/)
      assert.equal(trace.processing, false)

      stubFetch(() => ({status: 404, body: JSON.stringify({error: {message: 'Trace not found', code: 'not_found'}})}))
      await assert.rejects(client('sk-test').traceGet('nope'), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /No trace 'nope'/)
        assert.equal(err.exitCode, EXIT_DEFECT)
        return true
      })
    })

    it('resultPayload sends jsonPath and keysOnly, and prints the server sentence on a 404', async () => {
      const {calls} = stubFetch(() => ({body: JSON.stringify({format: 'json', contents: {a: 1}, jsonPath: 'x.0'})}))
      const payload = await client('sk-test').resultPayload('r1', {jsonPath: 'x.0', keysOnly: true})
      const url = new URL(calls[0].url)
      assert.equal(url.pathname, '/platform/results/r1/payload')
      assert.equal(url.searchParams.get('jsonPath'), 'x.0')
      assert.equal(url.searchParams.get('keysOnly'), 'true')
      assert.deepEqual(payload.contents, {a: 1})

      await client('sk-test').resultPayload('r1', {})
      assert.equal(new URL(calls[1].url).search, '')

      stubFetch(() => ({
        status: 404,
        body: JSON.stringify({error: {message: 'No result r9 found. Results are kept for 45 days.', code: 'not_found'}}),
      }))
      await assert.rejects(client('sk-test').resultPayload('r9', {}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /kept for 45 days/)
        assert.equal(err.exitCode, EXIT_DEFECT)
        return true
      })
    })

    it('partnerList and partnerGet read the partner endpoints', async () => {
      const {calls} = stubFetch((r) =>
        r.url.endsWith('/platform/partners')
          ? {body: JSON.stringify({partners: [{key: 'ACME'}], pagination: {hasMore: false, nextCursor: null}})}
          : {body: JSON.stringify({key: 'ACME', transactionSets: [], flows: []})},
      )
      const page = await client('sk-test').partnerList({})
      assert.equal(page.partners[0]?.key, 'ACME')
      const partner = await client('sk-test').partnerGet('acme')
      assert.match(calls[1].url, /\/platform\/partners\/acme$/)
      assert.equal(partner.key, 'ACME')
    })

    it('partnerGet on an unknown key points at partner list', async () => {
      stubFetch(() => ({status: 404, body: JSON.stringify({error: {message: 'No partner found with key nope.', code: 'not_found', reason: 'partner'}})}))
      await assert.rejects(client('sk-test').partnerGet('nope'), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /No partner 'nope' in your organization/)
        assert.equal(err.exitCode, EXIT_DEFECT)
        assert.ok(err.suggestions.some((s) => s.includes('tedi partner list')))
        return true
      })
    })

    it('partnerSend distinguishes a missing partner from a set the partner does not take', async () => {
      stubFetch(() => ({
        status: 404,
        body: JSON.stringify({error: {message: 'Transaction set 850 is not configured for outbound on partner PETCO. It takes 810, 856.', code: 'not_found', reason: 'transaction_set'}}),
      }))
      await assert.rejects(client('sk-test').partnerSend('PETCO', '850', {}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /Transaction set 850 is not configured for outbound on partner PETCO/)
        assert.doesNotMatch(err.message, /No partner/)
        assert.equal(err.exitCode, EXIT_DEFECT)
        return true
      })
    })

    it('transactionGet turns a coded 404 into a data-not-found defect', async () => {
      stubFetch(() => ({status: 404, body: JSON.stringify({error: {message: 'EDI transaction not found', code: 'not_found'}})}))
      await assert.rejects(client('sk-test').transactionGet('nope'), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.match(err.message, /No transaction 'nope'/)
        assert.equal(err.exitCode, EXIT_DEFECT)
        return true
      })
    })

    it('transactionGet reads a code-less 404 as a missing route, not a missing record', async () => {
      // A wrong base path or an older server answers a 404 without the plane's
      // shape. Asserting "no such transaction" (exit 1) there would hand CI a
      // false verdict about a record that exists.
      stubFetch(() => ({status: 404, body: '<html>Not Found</html>'}))
      await assert.rejects(client('sk-test').transactionGet('real-id'), (err: unknown) => {
        assert.ok(err instanceof NoSuchEndpointError)
        assert.match(err.message, /No such endpoint at http:\/\/localhost:5004/)
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        return true
      })
    })

    it('reads the nested platform error body and surfaces a sandbox 403 verbatim', async () => {
      stubFetch(() => ({
        status: 403,
        body: JSON.stringify({error: {message: "Sandbox keys are read-only and scoped to their sink's results.", code: 'forbidden'}}),
      }))
      await assert.rejects(client('sk-test').transactionList({}), /sandbox keys are read-only/i)
    })

    it('partnerReceive maps invalid_edi to a defect exit', async () => {
      stubFetch(() => ({
        status: 422,
        body: JSON.stringify({error: {message: 'Contents do not look like an X12 interchange: Content does not start with ISA.', code: 'invalid_edi'}}),
      }))
      await assert.rejects(client('sk-test').partnerReceive('ACME', 'not edi'), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.equal(err.exitCode, EXIT_DEFECT)
        assert.match(err.message, /does not start with ISA/)
        return true
      })
    })

    it('suggestionSubmit posts the fields and returns a duplicate as a receipt', async () => {
      const {calls} = stubFetch(() => ({
        status: 200,
        body: JSON.stringify({id: 's-1', title: 'Gap', category: 'api', status: 'new', createdAt: '2026-09-24T00:00:00Z', duplicate: true}),
      }))
      const input = {body: 'A gap.', tried: 'Called X.', expected: 'Y.', title: 'Gap', category: 'api' as const, traceGuid: 't-1'}
      const receipt = await client('sk-test').suggestionSubmit(input)
      assert.match(calls[0].url, /\/platform\/suggestions$/)
      assert.equal(calls[0].method, 'POST')
      assert.deepEqual(JSON.parse(calls[0].body!), input)
      assert.equal(receipt.duplicate, true)
    })

    it('suggestionSubmit maps the daily-cap 429 to the server sentence, not the generic rate limit', async () => {
      stubFetch(() => ({
        status: 429,
        body: JSON.stringify({error: {message: 'The limit is reached. Do not retry.', code: 'rate_limited', reason: 'daily_cap'}}),
      }))
      await assert.rejects(client('sk-test').suggestionSubmit({body: 'b', tried: 't', expected: 'e'}), (err: unknown) => {
        assert.ok(err instanceof TediError)
        assert.ok(!(err instanceof RateLimitedError))
        assert.equal(err.exitCode, EXIT_UNUSABLE)
        assert.equal(err.message, 'The limit is reached. Do not retry.')
        return true
      })
    })

    it('suggestionSubmit leaves the per-minute 429 to the generic rate limit', async () => {
      stubFetch(() => ({
        status: 429,
        headers: {'retry-after': '30'},
        body: JSON.stringify({error: {message: 'Rate limit exceeded. Please try again later.', code: 'rate_limited'}}),
      }))
      await assert.rejects(client('sk-test').suggestionSubmit({body: 'b', tried: 't', expected: 'e'}), (err: unknown) => {
        assert.ok(err instanceof RateLimitedError)
        assert.equal(err.retryAfterSeconds, 30)
        return true
      })
    })

    it('partnerSend posts contents and unwraps the receipt', async () => {
      const {calls} = stubFetch(() => ({
        body: JSON.stringify({
          message: 'Processing queued',
          interchangeControlNumber: '000000001',
          groupControlNumber: '000000002',
          traceGuid: 'trace-1',
          ediTransactionId: 'txn-1',
        }),
      }))
      const receipt = await client('sk-test').partnerSend('acme', '850', {po: 1}, 'order.json')
      assert.match(calls[0].url, /\/platform\/partners\/acme\/ts\/850$/)
      assert.equal(calls[0].method, 'POST')
      assert.deepEqual(JSON.parse(calls[0].body!), {contents: {po: 1}, filename: 'order.json'})
      assert.equal(receipt.traceGuid, 'trace-1')
      assert.equal(receipt.ediTransactionId, 'txn-1')
    })
  })
})

describe('retryAfterSeconds', () => {
  const now = Date.UTC(2026, 8, 11, 12, 0, 0)

  it('reads delta-seconds as sent', () => {
    assert.equal(retryAfterSeconds('42', now), 42)
    assert.equal(retryAfterSeconds(' 7 ', now), 7)
  })

  it('reads an HTTP-date against the clock, rounded up, never negative', () => {
    assert.equal(retryAfterSeconds('Fri, 11 Sep 2026 12:00:30 GMT', now), 30)
    assert.equal(retryAfterSeconds('Fri, 11 Sep 2026 11:59:00 GMT', now), 0)
  })

  it('gives no hint for a missing or unreadable header', () => {
    assert.equal(retryAfterSeconds(null, now), undefined)
    assert.equal(retryAfterSeconds('', now), undefined)
    assert.equal(retryAfterSeconds('soon', now), undefined)
    assert.equal(retryAfterSeconds('-5', now), undefined)
  })
})
