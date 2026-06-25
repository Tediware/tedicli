#!/usr/bin/env node
/**
 * Release preflight: verify the package that WOULD be published is well-formed,
 * before any version bump or publish. This is the deterministic, easy-to-skip
 * part of a release — most importantly it inspects the npm tarball to confirm the
 * compiled `dist/` is actually included and that no source/build-cache files leak.
 *
 * (A real broken build once shipped an empty `dist/`; this guard exists so that
 * can never reach npm silently.)
 *
 * Read-only: builds into ./dist and writes/removes a temporary oclif.manifest.json,
 * but changes nothing tracked. Exits non-zero if the tarball is malformed.
 */

import {execSync} from 'node:child_process'
import {readFileSync, rmSync} from 'node:fs'

function run(cmd) {
  return execSync(cmd, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']})
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const failures = []
const notes = []

// 1. Produce the exact file set that `npm publish` would ship. We replicate the
//    prepack steps (build + manifest) ourselves, then pack with --ignore-scripts
//    so the JSON output isn't polluted by lifecycle script logging.
console.log('• Building and computing the publishable file list...')
run('npm run build')
run('npx oclif manifest')
let files = []
try {
  const out = run('npm pack --dry-run --json --ignore-scripts')
  files = (JSON.parse(out)[0]?.files ?? []).map((f) => f.path.replace(/^\.\//, ''))
} finally {
  rmSync('oclif.manifest.json', {force: true})
}

// 2. Required files must be present.
const required = ['package.json', 'oclif.manifest.json', 'dist/index.js']
for (const r of required) {
  if (!files.includes(r)) failures.push(`Tarball is missing required file: ${r}`)
}
if (!files.some((p) => /^dist\/commands\/.+\.js$/.test(p))) {
  failures.push('Tarball contains no compiled commands (dist/commands/*.js). The build likely emitted nothing.')
}

// 3. Nothing that should never ship.
const leaks = files.filter(
  (p) => p.startsWith('src/') || p.startsWith('test/') || p.endsWith('.tsbuildinfo') || (/\.ts$/.test(p) && !/\.d\.ts$/.test(p)),
)
if (leaks.length > 0) failures.push(`Tarball includes files that should not ship: ${leaks.join(', ')}`)

console.log(`  → ${files.length} files in tarball; ${files.filter((p) => p.startsWith('dist/')).length} under dist/.`)

// 4. Is this version already on npm? (Informational — a release bumps first.)
console.log(`• Checking npm for ${pkg.name}@${pkg.version}...`)
let publishedVersion = ''
try {
  // Quiet: a 404 (whole package missing) throws; a missing version of an existing
  // package returns empty stdout with exit 0. Both mean "this version isn't published".
  publishedVersion = execSync(`npm view ${pkg.name}@${pkg.version} version`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  publishedVersion = ''
}
if (publishedVersion) {
  notes.push(
    `${pkg.name}@${pkg.version} is ALREADY published. Bump the version (npm version <patch|minor|major>) before releasing.`,
  )
} else {
  notes.push(`${pkg.name}@${pkg.version} is not yet on npm — OK to publish this version.`)
}

// Report.
console.log('')
if (notes.length) {
  console.log('Notes:')
  for (const n of notes) console.log(`  - ${n}`)
  console.log('')
}
if (failures.length > 0) {
  console.error('Release preflight FAILED:')
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('Release preflight passed: the publishable tarball looks correct.')
