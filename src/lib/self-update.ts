/**
 * npm-native self-update. `tedi` is distributed via `npm install -g`, and
 * @oclif/plugin-update cannot self-update an npm install (it needs a binPath that
 * only the standalone tarball installers set). So `tedi update` simply re-runs
 * npm to install the latest (or a requested) version.
 *
 * It only does so when the running binary is the one npm would replace. Under
 * nvm each Node has its own global prefix, and a checkout linked or wrapped
 * onto PATH is not an npm install at all; in both cases `npm install -g` would
 * put a copy somewhere the user is not running from and report success.
 */

import {spawn} from 'node:child_process'
import {realpath} from 'node:fs/promises'
import {join, resolve, sep} from 'node:path'

import {TediError} from './errors.js'

export const PACKAGE_NAME = '@tediware/tedi'

// Allow only characters that appear in npm version/dist-tag specifiers (incl.
// semver build metadata `+`). This is a safety guard because the install may be
// spawned through a shell on Windows; none of these characters are shell-special.
const SAFE_VERSION = /^[\w.+-]+$/

/** Build the `npm install -g <pkg>@<version|latest>` argument list. */
export function npmInstallArgs(pkgName: string, version?: string): string[] {
  let spec = `${pkgName}@latest`
  if (version) {
    if (!SAFE_VERSION.test(version)) {
      throw new TediError(`Invalid version: ${version}`, {
        suggestions: ['Use a version like 1.2.3, or leave it off to install the latest.'],
      })
    }
    spec = `${pkgName}@${version}`
  }
  return ['install', '-g', spec]
}

/** Runs a command and resolves with its exit code. Injectable for tests. */
export type Runner = (command: string, args: string[]) => Promise<number>

/** Runs a command and resolves with its stdout. Injectable for tests. */
export type Capture = (command: string, args: string[]) => Promise<string>

const defaultRunner: Runner = (command, args) =>
  new Promise((resolve, reject) => {
    // npm is `npm.cmd` on Windows, which requires a shell to resolve.
    const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'})
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })

const defaultCapture: Capture = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32'})
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`))))
  })

/** Where npm puts a global package under a given prefix. */
export function globalPackageDir(prefix: string, pkgName: string, platform: string = process.platform): string {
  const nodeModules = platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
  return join(nodeModules, ...pkgName.split('/'))
}

/**
 * Explain why the running binary is not something `npm install -g` would
 * replace, or return undefined when it is. `argv1` is the entry script as
 * invoked and `real` its resolved location.
 */
export function describeForeignInstall(
  argv1: string,
  real: string,
  prefix: string,
  pkgName: string,
  platform: string = process.platform,
): string | undefined {
  const expected = globalPackageDir(prefix, pkgName, platform)
  const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep)
  if (inside(real, expected)) return undefined

  if (!real.includes(`${sep}node_modules${sep}`)) {
    return resolve(argv1) === real
      ? `it runs from ${real}, which is not an npm install (a wrapper or a checkout)`
      : `${argv1} is a link to ${real}, which is not an npm install (a checkout or a wrapper)`
  }
  return `it runs from ${real}, but npm's global prefix is ${prefix} and it would install into ${expected}`
}

const resolveReal = async (path: string): Promise<string> => {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Refuse to update a binary that npm did not install where it is running from.
 * Injectable so tests need neither npm nor a global install.
 */
export async function assertUpdatable(opts: {
  argv1?: string
  capture?: Capture
  pkgName?: string
  platform?: string
} = {}): Promise<void> {
  const pkgName = opts.pkgName ?? PACKAGE_NAME
  const argv1 = opts.argv1 ?? process.argv[1] ?? ''
  const capture = opts.capture ?? defaultCapture

  const real = await resolveReal(argv1)

  let prefix: string
  try {
    prefix = await capture('npm', ['prefix', '-g'])
  } catch {
    throw new TediError('Could not ask npm for its global prefix.', {
      suggestions: [`Make sure npm is installed, then run \`npm install -g ${pkgName}\` yourself.`],
    })
  }

  // Both sides resolved, so a prefix that is itself a symlink (Homebrew on
  // some layouts) compares equal to the binary's real location under it.
  const why = describeForeignInstall(argv1, real, await resolveReal(prefix), pkgName, opts.platform)
  if (why) {
    throw new TediError(`tedi update cannot update this copy: ${why}.`, {
      suggestions: [
        'Update it the way it was installed: pull the checkout, or reinstall with the tool that put it there.',
        `To switch to an npm install, run \`npm install -g ${pkgName}\` and make sure that copy is first on PATH.`,
      ],
    })
  }
}

/** Install the latest (or requested) version of tedi via npm. */
export async function selfUpdate(
  version?: string,
  opts: {runner?: Runner; pkgName?: string} = {},
): Promise<void> {
  const pkgName = opts.pkgName ?? PACKAGE_NAME
  const args = npmInstallArgs(pkgName, version)
  const runner = opts.runner ?? defaultRunner

  let code: number
  try {
    code = await runner('npm', args)
  } catch {
    throw new TediError('Could not run npm to update tedi.', {
      suggestions: [`Make sure npm is installed, then run \`npm install -g ${pkgName}\` yourself.`],
    })
  }

  if (code !== 0) {
    throw new TediError(`npm exited with code ${code} while updating ${pkgName}.`, {
      suggestions: [`Try running \`npm install -g ${pkgName}\` yourself.`],
    })
  }
}
