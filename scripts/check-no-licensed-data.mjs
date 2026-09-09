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
 * EULA and the server-side rate limit.
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

// Lines that look like an X12 code value or element/segment definition row.
// Two shapes are matched so the density check covers both human-readable dumps
// and recorded JSON API responses (a recorded response is an explicit risk):
//   - tabular:  "AA   Some description"  /  "01  Reference Identification  ID  M"
//   - JSON map: "AA": "Some description"  /  { "code": "AA", ... }
const DEFINITION_LINES = [/^\s*[A-Z0-9]{1,4}\s+\S+.*/, /^\s*"[A-Z0-9]{1,4}"\s*:/]
const DENSITY_THRESHOLD = 25

// Scans git-tracked files only. That matches the thing we actually want to
// prevent — licensed data reaching the repo/publish — and mirrors what CI sees
// after checkout. Untracked working-tree files are intentionally out of scope.
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

  const defLines = content.split('\n').filter((line) => DEFINITION_LINES.some((re) => re.test(line))).length
  if (defLines >= DENSITY_THRESHOLD) {
    failures.push(
      `${file}: ${defLines} definition/code-list-like lines (threshold ${DENSITY_THRESHOLD}). ` +
        `If this file is genuinely synthetic, add the marker "${SYNTHETIC_MARKER}".`,
    )
  }
}

// Positioning check. The X12 reference is licensed and served as presentation
// only, and the shipped copy describes it by its properties rather than by
// who reads it. Concretely: no sentence in a customer-facing surface pairs a
// reference command or tool with the words agent, AI, model or LLM. The data
// plane, inspect, obfuscate and the MCP bridge carry no such restriction.
// "Model Context Protocol" is the protocol's name and is masked before matching.
const POSITIONING_FILES = ['README.md', 'AGENTS.md', 'API.md', 'package.json']
const REFERENCE_TERMS =
  /\bx12 (seg|ele|txn|segment|element|transaction|releases?)\b|x12_(segment|element|transaction_set|releases)|\bX12 (reference|standard)\b|\breference (tools?|lookups?|data|content|pages?)\b/i
const AUDIENCE_TERMS = /\bagents?\b|\bAI\b|\bmodels?\b|\bLLMs?\b/i
const PROTOCOL_NAME = /model context protocol|modelcontextprotocol/gi

function sentences(text) {
  return text
    .replace(PROTOCOL_NAME, 'MCP')
    .split(/(?<=[.!?])\s+|\n\s*\n|\n(?=\s*[-|#*])/)
}

function stringValues(value) {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues)
  return []
}

const commandFiles = trackedFiles().filter((f) => f.startsWith('src/commands/') && f.endsWith('.ts'))
for (const file of [...POSITIONING_FILES, ...commandFiles]) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  // JSON is checked one string value at a time, since its lines carry no sentence punctuation.
  const texts = file.endsWith('.json') ? stringValues(JSON.parse(content)) : [content]
  for (const sentence of texts.flatMap(sentences)) {
    if (REFERENCE_TERMS.test(sentence) && AUDIENCE_TERMS.test(sentence)) {
      failures.push(`${file}: pairs the X12 reference with an audience word: ${JSON.stringify(sentence.trim().slice(0, 120))}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Licensed-data tripwire FAILED. The following tracked files look like they may contain')
  console.error('licensed X12 reference data, which must never be committed, or describe it in a way the license does not allow:\n')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nIf these are false positives, narrow the file or add the synthetic marker, then re-run.')
  process.exit(1)
}

console.log('Licensed-data tripwire passed: no tracked file looks like licensed X12 reference data.')
