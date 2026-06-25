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
 */
export async function fetchWithTimeout(
  url: string | URL,
  opts: {timeoutMs?: number; headers?: Record<string, string>} = {},
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    return await fetch(url, {headers: opts.headers, signal: controller.signal})
  } finally {
    clearTimeout(timer)
  }
}
