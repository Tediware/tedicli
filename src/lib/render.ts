/**
 * Human renderings shared by the data-plane commands, so a result, an error
 * and an artifact read the same whichever command shows them.
 */

import {ArtifactPointer, ArtifactRole, PlatformResult, ResultDetail, TraceArtifact} from './platform.js'
import {cell, formatTime, renderTable} from './table.js'

/** The first line of a possibly multi-line message. */
export function firstLine(text: string | undefined | null): string {
  return (text ?? '').split('\n')[0]?.trim() ?? ''
}

/**
 * An error and the findings behind it, one per line under the message. The
 * message is a sentence; the findings are what to fix.
 */
export function errorLines(detail: ResultDetail, indent = '  '): string[] {
  const lines: string[] = []
  if (detail.errorMessage) lines.push(detail.errorMessage)
  for (const finding of detail.errors ?? []) lines.push(`${indent}- ${finding}`)
  return lines
}

/** The artifact table, with the fetch hint, for a list of pointers. */
export function artifactTable(artifacts: ArtifactPointer[]): string[] {
  if (artifacts.length === 0) return []
  return [
    'Artifacts (fetch with `tedi artifact get <id>`):',
    renderTable([
      ['ID', 'USAGE', 'TYPE', 'FILENAME'],
      ...artifacts.map((a) => [a.id, a.usage, cell(a.contentType), cell(a.filename)]),
    ]),
  ]
}

/** The artifact table for a trace: every artifact once, labeled by producing node. */
export function traceArtifactTable(artifacts: TraceArtifact[]): string[] {
  if (artifacts.length === 0) return []
  return [
    'Artifacts (fetch with `tedi artifact get <id>`):',
    renderTable([
      ['ID', 'USAGE', 'PRODUCED BY', 'TYPE', 'FILENAME'],
      ...artifacts.map((a) => [a.id, a.usage, cell(a.nodeName), cell(a.contentType), cell(a.filename)]),
    ]),
  ]
}

/** One artifact role as a labeled line: who produced it and, when stored, the pointer. */
export function roleLine(label: string, role: ArtifactRole | null): string {
  if (!role) return `${label.padEnd(16)}-`
  const where = cell(role.nodeName)
  if (!role.id) return `${label.padEnd(16)}${where} (no stored artifact)`
  return `${label.padEnd(16)}${role.id}  ${cell(role.filename)}  from ${where}`
}

/** One result as a table row: created, node, status, one-line error. */
export function resultRow(r: PlatformResult): string[] {
  return [formatTime(r.createdAt), cell(r.nodeName), r.status, firstLine(r.detail.errorMessage) || '-']
}
