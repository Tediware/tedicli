/**
 * Minimal column alignment for data-plane list output. Plain spaces, no box
 * drawing and no ANSI, so piped output stays clean; anything fancier belongs to
 * `--json`.
 */

/** Render rows as space-aligned columns. The first row is the header. */
export function renderTable(rows: string[][]): string {
  if (rows.length === 0) return ''
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length)
    })
  }

  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ').trimEnd())
    .join('\n')
}

/** ISO timestamp trimmed to the minute, for list columns. */
export function shortTime(iso: string): string {
  return iso.replace(/:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '')
}

/** Placeholder for a null-ish cell. */
export function cell(value: string | null | undefined): string {
  return value ?? '-'
}
