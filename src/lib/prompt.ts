/**
 * Minimal terminal input helpers for secret entry, with no third-party prompt
 * dependency. Used by `tedi auth login` so an API key is entered via a no-echo
 * prompt or piped stdin — never through a command-line flag or argv, where it
 * would leak into shell history and process listings.
 */

import {createInterface} from 'node:readline'

/** Read all of stdin to a string. For piped, non-interactive input (CI). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Prompt on the terminal and read one line with the typed characters hidden, so
 * a pasted secret never echoes to the screen or scrollback. Interactive (TTY)
 * use only; callers should prefer `readStdin` when stdin is not a TTY.
 */
export async function promptSecret(prompt: string): Promise<string> {
  const rl = createInterface({input: process.stdin, output: process.stdout})
  // readline renders typed input via the internal `_writeToOutput`; no-op it so
  // nothing is echoed. The prompt itself is written directly below.
  ;(rl as unknown as {_writeToOutput: (s: string) => void})._writeToOutput = () => {}
  process.stdout.write(prompt)
  try {
    return await new Promise<string>((resolve) => rl.question('', resolve))
  } finally {
    process.stdout.write('\n')
    rl.close()
  }
}
