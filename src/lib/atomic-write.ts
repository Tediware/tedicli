import {chmod, mkdir, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

/**
 * Write a file atomically with a guaranteed mode.
 *
 * The content is written to a sibling temp file (created with the requested
 * mode, then chmod'd to defeat umask) and renamed into place. rename(2) is
 * atomic within a filesystem, so readers never observe a partial file, and the
 * secret content never exists at the final path under loose permissions — which
 * matters for credential storage.
 */
export async function writeFileAtomic(file: string, data: string, mode: number): Promise<void> {
  await mkdir(dirname(file), {recursive: true})
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, data, {encoding: 'utf8', mode})
  await chmod(tmp, mode)
  await rename(tmp, file)
}
