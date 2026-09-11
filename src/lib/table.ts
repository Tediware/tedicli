/**
 * Minimal column alignment for data-plane list output. Plain spaces, no box
 * drawing and no ANSI, so piped output stays clean; anything fancier belongs to
 * `--json`.
 */

/** The width of each column, from the widest cell in it. */
export function columnWidths(rows: string[][]): number[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length)
    })
  }
  return widths
}

/**
 * Render rows as space-aligned columns. The first row is the header. Pass
 * `widths` to align against columns computed elsewhere, which is what lets a
 * tail print rows one batch at a time under a single header.
 */
export function renderTable(rows: string[][], widths: number[] = columnWidths(rows)): string {
  if (rows.length === 0) return ''
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ').trimEnd())
    .join('\n')
}

/**
 * A server timestamp for a person: `YYYY-MM-DD HH:MM:SSZ`. Every timestamp the
 * platform sends is UTC, and the `Z` says so, since the sub-second digits it
 * carries are more than a reader needs and the zone is less than a reader
 * copying the value into `--since` can do without. JSON output is untouched.
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

/** Placeholder for a null-ish cell. */
export function cell(value: string | null | undefined): string {
  return value ?? '-'
}
