import {chmod, mkdir, rename, rm, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

import {FileAccessError} from './errors.js'

/**
 * Write a file atomically with a guaranteed mode.
 *
 * The content is written to a sibling temp file (created with the requested
 * mode, then chmod'd to defeat umask) and renamed into place. rename(2) is
 * atomic within a filesystem, so readers never observe a partial file, and the
 * secret content never exists at the final path under loose permissions, which
 * matters for credential storage.
 *
 * A failure is reported against the path the caller asked for, never the temp
 * path, and the temp file is removed so a full disk or a bad directory does not
 * leave a stray `.tmp` behind.
 */
export async function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  mode: number,
  encoding: BufferEncoding = 'utf8',
): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await mkdir(dirname(file), {recursive: true})
    await writeFile(tmp, data, typeof data === 'string' ? {encoding, mode} : {mode})
    await chmod(tmp, mode)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, {force: true}).catch(() => {})
    throw new FileAccessError('write', file, err)
  }
}
