/**
 * Shared input handling for the commands that take a document: read it from a
 * path, or from stdin when the argument is `-` or omitted on a pipe. The
 * filesystem error wording and the "you are piping into a terminal" hint live
 * here rather than being restated per command.
 */

import {readFile} from 'node:fs/promises'

import {FileAccessError, TediError} from './errors.js'
import {readStdinBytes} from './prompt.js'

export type InputEncoding = 'latin1' | 'utf8'

export interface ReadInputOptions {
  /** What the file is, for the messages ("EDI file", "JSON document"). */
  noun: string
  /** Receives the hint printed when stdin is read from a terminal. */
  notify: (message: string) => void
}

/** A document's text and the encoding it was decoded with, so it can be written back the same way. */
export interface EdiDocument {
  text: string
  encoding: InputEncoding
}

/** Whether `file` names stdin: an explicit `-`, or nothing at all on a pipe. */
export function readsStdin(file: string | undefined): boolean {
  if (file === '-') return true
  return file === undefined && !process.stdin.isTTY
}

/**
 * The raw bytes of a document from `file`, from stdin when `file` is `-`, or
 * from stdin when `file` is omitted and stdin is not a terminal (so
 * `cat f | tedi ...` works with and without the `-`). Omitted on a terminal is
 * an error: the command has nothing to read.
 */
export async function readDocumentBytes(file: string | undefined, opts: ReadInputOptions): Promise<Buffer> {
  if (readsStdin(file)) {
    if (process.stdin.isTTY) {
      opts.notify(`Reading the ${opts.noun} from the terminal. Paste it, then press Ctrl+D.`)
    }
    return readStdinBytes()
  }

  if (file === undefined) {
    throw new TediError(`No ${opts.noun} given.`, {
      suggestions: ['Pass a path, or pipe the document in on stdin (`-` also reads stdin).'],
    })
  }

  try {
    return await readFile(file)
  } catch (err) {
    throw new FileAccessError('read', file, err)
  }
}

const strictUtf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})

/**
 * Decode EDI bytes without losing any. Valid UTF-8 is read as UTF-8, which is
 * what a file with accented names almost always is. Anything else is read as
 * latin1, a byte-for-byte mapping, so a Latin-1 interchange survives a read
 * and a write unchanged instead of growing replacement characters. The
 * encoding comes back so the writer can put the bytes back the same way.
 */
export function decodeEdi(bytes: Buffer): EdiDocument {
  try {
    return {text: strictUtf8.decode(bytes), encoding: 'utf8'}
  } catch {
    return {text: bytes.toString('latin1'), encoding: 'latin1'}
  }
}

/** Read an X12 interchange, with the encoding it should be written back in. */
export async function readEdiDocument(file: string | undefined, notify: (message: string) => void): Promise<EdiDocument> {
  return decodeEdi(await readDocumentBytes(file, {noun: 'EDI file', notify}))
}

/** Read an X12 interchange as text. */
export async function readEdiInput(file: string | undefined, notify: (message: string) => void): Promise<string> {
  return (await readEdiDocument(file, notify)).text
}

/** Read a JSON document as text. */
export async function readJsonInput(file: string | undefined, notify: (message: string) => void): Promise<string> {
  return (await readDocumentBytes(file, {noun: 'JSON document', notify})).toString('utf8')
}
