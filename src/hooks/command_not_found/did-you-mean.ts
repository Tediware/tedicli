/**
 * A mistyped command is misuse, and misuse exits 2.
 *
 * @oclif/plugin-not-found does the suggesting, but it exits 127 and writes
 * ANSI to stderr whatever stderr is. 127 is the shell's "command not found",
 * and an agent branching on the three-way contract reads it as neither a
 * finding nor a tool failure. This hook replaces the plugin: same
 * did-you-mean, the CLI's own exit code, and no color where nothing can
 * render it.
 *
 * The suggestion is a Levenshtein match against every command and alias, on
 * the space-separated form the user typed rather than oclif's internal colon
 * id, because `tedi transactoin list` is what they ran.
 */

import {Hook} from '@oclif/core'

import {EXIT_UNUSABLE} from '../../lib/errors.js'

/** Edit distance, capped: anything past `max` is as bad as anything else. */
export function distance(a: string, b: string, max = 4): number {
  if (Math.abs(a.length - b.length) > max) return max + 1

  let previous = Array.from({length: b.length + 1}, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost)
    }
    previous = current
  }

  return previous[b.length] ?? max + 1
}

/**
 * The closest command id to what was typed, or undefined when nothing is
 * close enough to be worth guessing at. The threshold scales with length so a
 * three-letter typo does not match every three-letter command.
 */
export function closestCommand(typed: string, ids: string[]): string | undefined {
  const threshold = Math.max(2, Math.floor(typed.length / 3))
  let best: {id: string; score: number} | undefined

  for (const id of ids) {
    const score = distance(typed, id)
    if (score <= threshold && (best === undefined || score < best.score)) best = {id, score}
  }

  return best?.id
}

const hook: Hook<'command_not_found'> = async function (opts) {
  const separator = opts.config.topicSeparator ?? ':'
  const typed = (opts.id ?? '').split(':').join(separator)

  const ids = opts.config.commandIDs.flatMap((id) => {
    const command = opts.config.findCommand(id)
    return [id, ...(command?.aliases ?? [])]
  })
  const suggestion = closestCommand(opts.id ?? '', ids)

  const lines = [`${typed} is not a tedi command.`]
  if (suggestion) lines.push(`Did you mean ${opts.config.bin} ${suggestion.split(':').join(separator)}?`)
  lines.push(`Run ${opts.config.bin} help for the full list.`)

  process.stderr.write(`${lines.join('\n')}\n`)
  return this.exit(EXIT_UNUSABLE)
}

export default hook
