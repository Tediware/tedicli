/**
 * Output helpers. The key policy here implements the brief's color rule: colored
 * `console` output is rendered server-side and requested by the CLI *only* when
 * stdout is an interactive terminal and color has not been disabled. Piped or
 * redirected output stays clean, and `markdown` is never colored.
 */

export type OutputFormat = 'console' | 'markdown'

export interface TtyContext {
  /** Override the TTY check (used in tests). Defaults to `process.stdout.isTTY`. */
  isTty?: boolean
}

export interface ColorContext extends TtyContext {
  /** Value of the `--no-color` flag. */
  noColorFlag?: boolean
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

/**
 * Decide whether to ask for the complete element code list when the user didn't
 * say either way.
 *
 * The server truncates long code lists in the `console` variant and appends a
 * footer telling the reader to run the lookup again for the rest. That footer is
 * an interactive affordance: it asks a *person* to type a second command. When
 * stdout is a pipe or a file there is nobody to act on it, so the truncation
 * costs a round trip the caller cannot take — piped output gets the whole list
 * for the same reason it gets no color.
 *
 * `markdown` is already complete, so there is nothing to ask for there.
 */
export function wantsFullCodeList(format: OutputFormat, ctx: TtyContext = {}): boolean {
  if (format !== 'console') return false
  const isTty = ctx.isTty ?? Boolean(process.stdout.isTTY)
  return !isTty
}
