/**
 * Small shared fetch helper with a timeout, so no network call can hang the CLI
 * indefinitely on a stalled connection. Used by both the API client and the
 * changelog fetcher.
 */

/** Default request timeout for platform API calls. */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Like `fetch`, but aborts after `timeoutMs`. On timeout the returned promise
 * rejects with the abort error; callers decide how to surface it.
 *
 * The deadline covers reading the response body, not just receiving the headers.
 * A server that answers 200 and then stalls mid-body is a real way to hang a CLI
 * forever, and the body is the large part of an inspection response. That is why
 * this uses `AbortSignal.timeout` rather than a hand-rolled timer cleared when
 * `fetch` resolves: the signal stays live until the caller has consumed the body,
 * and its timer is unref'd, so a pending deadline never keeps the process alive.
 *
 * `method`/`body` are optional so the same helper covers the reference reads
 * (GET, no body) and the inspect upload (POST). Callers that send a body are
 * responsible for its `content-type` header.
 */
export async function fetchWithTimeout(
  url: string | URL,
  opts: {timeoutMs?: number; headers?: Record<string, string>; method?: string; body?: string} = {},
): Promise<Response> {
  return fetch(url, {
    body: opts.body,
    headers: opts.headers,
    method: opts.method,
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
}
