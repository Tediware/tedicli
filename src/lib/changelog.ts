/**
 * Fetch release notes from GitHub Releases, for display after `tedi update`.
 *
 * Best-effort and non-fatal: any failure (offline, no release for the version,
 * rate limit) returns undefined so the update flow is never blocked by changelog
 * fetching. The changelog is a marketing surface — platform highlights can ride
 * along with CLI changes in the release body.
 */

import {fetchWithTimeout} from './http.js'

/** Changelog fetches are short-lived and strictly optional, so time out fast. */
export const CHANGELOG_TIMEOUT_MS = 3000

export interface ChangelogEntry {
  version: string
  /** Markdown body of the release. */
  notes: string
  url: string
}

/** Parse "owner/repo" from a package.json repository URL, if possible. */
export function parseRepoSlug(repositoryUrl: string | undefined): string | undefined {
  if (!repositoryUrl) return undefined
  // Match owner/repo, tolerating a trailing ".git" and/or slash. The repo group
  // is lazy so a repo name that itself contains dots (e.g. "next.js") is kept
  // intact rather than truncated at the first dot.
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (!match) return undefined
  return `${match[1]}/${match[2]}`
}

/**
 * Fetch a release for a repo: the specific tag when `version` is given (no
 * fallback — a missing tag yields undefined rather than a mislabeled release),
 * otherwise the latest published release.
 */
export async function fetchChangelog(
  repoSlug: string,
  opts: {version?: string; userAgent?: string; timeoutMs?: number} = {},
): Promise<ChangelogEntry | undefined> {
  const path = opts.version ? `releases/tags/${encodeURIComponent(opts.version)}` : 'releases/latest'
  const url = `https://api.github.com/repos/${repoSlug}/${path}`

  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: opts.timeoutMs ?? CHANGELOG_TIMEOUT_MS,
      headers: {accept: 'application/vnd.github+json', 'user-agent': opts.userAgent ?? 'tedi-cli'},
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as {tag_name?: string; body?: string; html_url?: string}
    if (!data.tag_name) return undefined
    return {
      version: data.tag_name,
      notes: (data.body ?? '').trim(),
      url: data.html_url ?? '',
    }
  } catch {
    return undefined
  }
}
