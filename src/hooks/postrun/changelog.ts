/**
 * After `tedi update` runs, fetch and display the changelog for the new version
 * from GitHub Releases. Best-effort: never throws, never blocks the update.
 */

import {Hook} from '@oclif/core'

import {fetchChangelog, parseRepoSlug} from '../../lib/changelog.js'

/** Read `--version X` / `--version=X` from the update command's argv, if present. */
function readVersionFlag(argv: string[]): string | undefined {
  const eq = argv.find((a) => a.startsWith('--version='))
  if (eq) return eq.slice('--version='.length)
  const i = argv.indexOf('--version')
  const next = i === -1 ? undefined : argv[i + 1]
  return next && !next.startsWith('-') ? next : undefined
}

function sameVersion(a: string, b: string): boolean {
  const norm = (v: string) => (v ?? '').replace(/^v/, '')
  return norm(a) === norm(b)
}

const hook: Hook<'postrun'> = async function (opts) {
  if (opts.Command?.id !== 'update') return

  const argv = opts.argv ?? []
  // `update --available` only lists versions; nothing was installed.
  if (argv.includes('--available')) return

  const {repository} = opts.config.pjson
  const repositoryUrl = typeof repository === 'string' ? repository : repository?.url
  const repoSlug = parseRepoSlug(repositoryUrl)
  if (!repoSlug) return

  const requestedVersion = readVersionFlag(argv)

  try {
    const entry = await fetchChangelog(repoSlug, {
      version: requestedVersion,
      userAgent: opts.config.userAgent,
    })
    if (!entry) return
    // Updating to "latest" while already on it installs nothing new — don't
    // print release notes for a version the user already had.
    if (!requestedVersion && sameVersion(entry.version, opts.config.version)) return

    this.log('')
    this.log(`What's new in ${entry.version}:`)
    this.log('')
    if (entry.notes) this.log(entry.notes)
    if (entry.url) {
      this.log('')
      this.log(entry.url)
    }
  } catch {
    // Changelog display is best-effort; stay silent on any failure.
  }
}

export default hook
