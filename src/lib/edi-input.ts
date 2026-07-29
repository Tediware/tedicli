/**
 * Shared input handling for the `edi` commands: read an interchange from a path
 * or from stdin. Both commands take the same `<file> | -` argument, so the
 * filesystem error wording and the "you are piping into a terminal" hint live
 * here rather than being restated per command.
 */

import {readFile} from 'node:fs/promises'

import {TediError} from './errors.js'
import {readStdin} from './prompt.js'

/**
 * Read an interchange from `file`, or from stdin when `file` is `-`.
 *
 * `notify` receives the terminal hint printed when `-` is used interactively —
 * without it the CLI just sits there looking hung while readline waits for EOF.
 * Commands pass their own stderr logger so the hint never lands on stdout.
 */
export async function readEdiInput(file: string, notify: (message: string) => void): Promise<string> {
  if (file === '-') {
    if (process.stdin.isTTY) notify('Reading EDI from the terminal — paste the interchange, then press Ctrl+D.')
    return readStdin()
  }

  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    const {code} = err as NodeJS.ErrnoException
    if (code === 'ENOENT') throw new TediError(`File not found: ${file}`)
    if (code === 'EISDIR') throw new TediError(`${file} is a directory, not an EDI file.`)
    throw err
  }
}
