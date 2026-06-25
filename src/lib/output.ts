/**
 * Output helpers. The key policy here implements the brief's color rule: colored
 * `console` output is rendered server-side and requested by the CLI *only* when
 * stdout is an interactive terminal and color has not been disabled. Piped or
 * redirected output stays clean, and `markdown` is never colored.
 */

export type OutputFormat = 'console' | 'markdown'

export interface ColorContext {
  /** Value of the `--no-color` flag. */
  noColorFlag?: boolean
  /** Override the TTY check (used in tests). Defaults to `process.stdout.isTTY`. */
  isTty?: boolean
}

/**
 * Decide whether the CLI should request server-side color for `console` output.
 *
 * Color is requested only when:
 *   - the format is `console` (markdown is never colored), and
 *   - stdout is an interactive terminal, and
 *   - `NO_COLOR` is unset, and
 *   - `--no-color` was not passed.
 */
export function wantsColor(format: OutputFormat, ctx: ColorContext = {}): boolean {
  if (format !== 'console') return false
  if (ctx.noColorFlag) return false
  // Per https://no-color.org, NO_COLOR disables color when present AND non-empty.
  // An empty value is intentionally treated as unset, so `NO_COLOR= tedi ...`
  // can re-enable color for a single invocation in a shell that exports it.
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  const isTty = ctx.isTty ?? Boolean(process.stdout.isTTY)
  return isTty
}
