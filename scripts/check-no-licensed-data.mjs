#!/usr/bin/env node
/**
 * Tripwire: fail CI if anything that looks like licensed X12 reference data has
 * been committed. Per the brief this is the single largest licensing risk for the
 * project, so the check is deliberately conservative — it would rather flag a
 * borderline file for human review than let real reference content slip in.
 *
 * It looks for two signals in tracked data files:
 *   1. Publisher / copyright markers that only appear on real licensed material.
 *   2. A high density of code-list / element-definition lines, which is what a
 *      dumped reference table or recorded API response looks like.
 *
 * A data file that is legitimately synthetic (e.g. a hand-written test fixture)
 * can opt out of the density check by including the marker `tedi:synthetic-data-ok`.
 * The marker does NOT bypass the publisher/copyright check.
 *
 * This is a tripwire, not a proof of cleanliness. The real protections are the
 * EULA and the server-side rate limit; see BRIEF.md.
 */

import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {extname} from 'node:path'

// Extensions that could plausibly carry dumped reference data.
const DATA_EXTENSIONS = new Set([
  '.json',
  '.ndjson',
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.xml',
  '.yaml',
  '.yml',
  '.snap',
])

// Files that are part of project scaffolding and never carry reference data.
const ALLOWLIST = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  'BRIEF.md',
  'CONTRIBUTING.md',
  'NOTICE',
  'oclif.manifest.json',
  'scripts/check-no-licensed-data.mjs',
])

// Strong markers: presence of any of these in a tracked file is an immediate fail.
const PUBLISHER_MARKERS = [
  /washington publishing/i,
  /data interchange standards association/i,
  /accredited standards committee/i,
  /\bDISA\b/,
  /copyright[^.\n]{0,40}\bX12\b/i,
  /\bX12\b[^.\n]{0,40}all rights reserved/i,
]

const SYNTHETIC_MARKER = 'tedi:synthetic-data-ok'

// A line that looks like an X12 code value or element/segment definition row,
// e.g. "AA   Some description" or "01  Reference Identification  ID  M".
const DEFINITION_LINE = /^\s*[A-Z0-9]{1,4}\s+\S+.*/
const DENSITY_THRESHOLD = 25

function trackedFiles() {
  const out = execSync('git ls-files', {encoding: 'utf8'})
  return out.split('\n').filter(Boolean)
}

const failures = []

for (const file of trackedFiles()) {
  if (ALLOWLIST.has(file)) continue
  if (!DATA_EXTENSIONS.has(extname(file))) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  for (const marker of PUBLISHER_MARKERS) {
    if (marker.test(content)) {
      failures.push(`${file}: matches licensed-data marker ${marker}`)
    }
  }

  if (content.includes(SYNTHETIC_MARKER)) continue

  const defLines = content.split('\n').filter((line) => DEFINITION_LINE.test(line)).length
  if (defLines >= DENSITY_THRESHOLD) {
    failures.push(
      `${file}: ${defLines} definition/code-list-like lines (threshold ${DENSITY_THRESHOLD}). ` +
        `If this file is genuinely synthetic, add the marker "${SYNTHETIC_MARKER}".`,
    )
  }
}

if (failures.length > 0) {
  console.error('Licensed-data tripwire FAILED. The following tracked files look like they may contain')
  console.error('licensed X12 reference data, which must never be committed (see BRIEF.md):\n')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nIf these are false positives, narrow the file or add the synthetic marker, then re-run.')
  process.exit(1)
}

console.log('Licensed-data tripwire passed: no tracked file looks like licensed X12 reference data.')
