/**
 * Human renderings shared by the data-plane commands, so a result, an error
 * and an artifact read the same whichever command shows them.
 */

import {ArtifactPointer, ArtifactRole, PartnerConnection, PlatformResult, ResultDetail, TraceArtifact, Warning} from './platform.js'
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

/**
 * The warnings on a document or a result, one per line: the stable code to
 * branch on, the prose, and the result that raised it when the caller is not
 * already looking at that result. Codes are padded so they read as a column.
 */
export function warningLines(warnings: (Warning & {resultId?: string})[]): string[] {
  const width = Math.max(0, ...warnings.map((w) => w.code.length))
  return warnings.map((w) => {
    const raised = w.resultId ? `  (result ${w.resultId})` : ''
    return `${w.code.padEnd(width)}  ${firstLine(w.message)}${raised}`
  })
}

/**
 * The status cell with its warning count beside it. A warning is its own axis
 * and never changes the status, so a delivered document that raised one still
 * reads `delivered` and the count sits next to the word rather than displacing
 * it. Nothing is added when there are no warnings.
 */
export function statusCell(status: string | null | undefined, warningCount: number | undefined): string {
  const count = warningCount ?? 0
  if (count <= 0) return cell(status)
  return `${cell(status)} (${count} warning${count === 1 ? '' : 's'})`
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

/**
 * A hosted SFTP login as label and value pairs, for `connection get` and
 * `partner get` to pad to their own columns. A label of '' continues the line
 * above. Without the server's details (an older server) the username stands
 * alone where the host would be.
 */
export function hostedSftpRows(c: PartnerConnection): [string, string][] {
  const rows: [string, string][] = []
  const server = c.hostedSftpServer
  if (server) {
    rows.push(['Host', `${server.host}:${server.port}${c.sftpUsername ? ` as ${c.sftpUsername}` : ''}`])
    const ips = server.staticIps ?? []
    if (ips.length > 0) rows.push(['Addresses', ips.join(', ')])
    for (const [i, key] of (server.hostKeyFingerprints ?? []).entries()) {
      rows.push([i === 0 ? 'Host keys' : '', key.keyType ? `${key.keyType} ${key.fingerprint}` : key.fingerprint])
    }
  } else {
    rows.push(['Username', cell(c.sftpUsername)])
  }

  const allowed = c.hostedSftpAllowedIps ?? []
  rows.push(['Allowed from', allowed.length > 0 ? allowed.join(', ') : 'any address'])
  const status = c.hostedSftpSetupStatus ?? 'inactive'
  rows.push(['Login', `${status}${c.hostedSftpSetupError ? ` (${c.hostedSftpSetupError})` : ''}`])
  return rows
}
