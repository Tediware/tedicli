#!/usr/bin/env node
/**
 * Build release notes for a tag from the commit log.
 *
 * `gh release create --generate-notes` derives its list from merged pull requests.
 * This repo commits straight to `main`, so it had nothing to list and every
 * release body was a bare "Full Changelog" link — which is what `tedi update`
 * shows users under "What's new". Read the commits instead.
 *
 * Usage:
 *   node scripts/release-notes.mjs v1.2.3   # notes for a tag (used by the release workflow)
 *   node scripts/release-notes.mjs --preview # notes for HEAD (used by /release-check)
 *
 * Writes markdown to stdout. Exits 1 if the range holds no releasable commits,
 * so an empty changelog is caught rather than published.
 */

import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'

function git(...args) {
  return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
}

/** npm's version-bump commit is titled just "1.2.3"; it is noise in a changelog. */
const isVersionBump = (subject) => /^v?\d+\.\d+\.\d+$/.test(subject.trim())

/** "owner/repo", for the compare link. Prefer the CI-provided value. */
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const url = JSON.parse(readFileSync('package.json', 'utf8')).repository?.url ?? ''
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}` : ''
}

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: release-notes.mjs <tag> | --preview')
  process.exit(2)
}

// Resolve the range. For a tag, walk back from the tagged commit's parent so the
// nearest preceding tag is found; for --preview, HEAD may or may not be tagged
// already, so step back past it when it is.
const preview = arg === '--preview'
const target = preview ? 'HEAD' : arg
let headIsTagged = false
try {
  headIsTagged = preview && git('tag', '--points-at', 'HEAD').length > 0
} catch {
  headIsTagged = false
}

let previous = ''
try {
  previous = git('describe', '--tags', '--abbrev=0', `${preview && !headIsTagged ? 'HEAD' : `${target}^`}`)
} catch {
  previous = '' // No prior tag: this is the first release, so use the whole history.
}

const range = previous ? `${previous}..${target}` : target
const subjects = git('log', '--no-merges', '--pretty=%s', range)
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !isVersionBump(s))

if (subjects.length === 0) {
  console.error(`No releasable commits in ${range} — the release notes would be empty.`)
  process.exit(1)
}

const slug = repoSlug()
const label = preview ? 'HEAD' : target
const lines = ["## What's changed", '', ...subjects.map((s) => `- ${s}`)]
if (slug && previous) {
  lines.push('', `**Full Changelog**: https://github.com/${slug}/compare/${previous}...${label}`)
}
console.log(lines.join('\n'))
