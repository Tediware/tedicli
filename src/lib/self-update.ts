/**
 * npm-native self-update. `tedi` is distributed via `npm install -g`, and
 * @oclif/plugin-update cannot self-update an npm install (it needs a binPath that
 * only the standalone tarball installers set). So `tedi update` simply re-runs
 * npm to install the latest (or a requested) version.
 */

import {spawn} from 'node:child_process'

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
        suggestions: ['Use a version like 1.2.3, or omit --version to install the latest.'],
      })
    }
    spec = `${pkgName}@${version}`
  }
  return ['install', '-g', spec]
}

/** Runs a command and resolves with its exit code. Injectable for tests. */
export type Runner = (command: string, args: string[]) => Promise<number>

const defaultRunner: Runner = (command, args) =>
  new Promise((resolve, reject) => {
    // npm is `npm.cmd` on Windows, which requires a shell to resolve.
    const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'})
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })

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
