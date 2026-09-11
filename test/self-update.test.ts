import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'

import {assertUpdatable, globalPackageDir, npmInstallArgs, PACKAGE_NAME, selfUpdate} from '../src/lib/self-update.js'

describe('npmInstallArgs', () => {
  it('installs the latest version by default', () => {
    assert.deepEqual(npmInstallArgs(PACKAGE_NAME), ['install', '-g', `${PACKAGE_NAME}@latest`])
  })

  it('installs a specific version when given', () => {
    assert.deepEqual(npmInstallArgs(PACKAGE_NAME, '1.2.3'), ['install', '-g', `${PACKAGE_NAME}@1.2.3`])
  })

  it('accepts dist-tags', () => {
    assert.deepEqual(npmInstallArgs(PACKAGE_NAME, 'next'), ['install', '-g', `${PACKAGE_NAME}@next`])
  })

  it('rejects an unsafe version string', () => {
    assert.throws(() => npmInstallArgs(PACKAGE_NAME, '1.2.3 && rm -rf /'), /Invalid version/)
  })
})

describe('selfUpdate', () => {
  it('resolves when npm exits 0', async () => {
    const calls: Array<{command: string; args: string[]}> = []
    await selfUpdate(undefined, {
      runner: async (command, args) => {
        calls.push({command, args})
        return 0
      },
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.command, 'npm')
    assert.deepEqual(calls[0]!.args, ['install', '-g', `${PACKAGE_NAME}@latest`])
  })

  it('passes a requested version through to npm', async () => {
    let received: string[] = []
    await selfUpdate('2.0.0', {runner: async (_c, args) => ((received = args), 0)})
    assert.deepEqual(received, ['install', '-g', `${PACKAGE_NAME}@2.0.0`])
  })

  it('throws when npm exits non-zero', async () => {
    await assert.rejects(selfUpdate(undefined, {runner: async () => 1}), /npm exited with code 1/)
  })

  it('throws a helpful error when npm cannot be run', async () => {
    await assert.rejects(
      selfUpdate(undefined, {
        runner: async () => {
          throw new Error('spawn npm ENOENT')
        },
      }),
      /Could not run npm/,
    )
  })
})

describe('assertUpdatable', () => {
  it('accepts a binary under a global prefix that is itself a symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tedi-update-'))
    try {
      const realPrefix = join(dir, 'real')
      const linkedPrefix = join(dir, 'linked')
      const bin = join(globalPackageDir(realPrefix, PACKAGE_NAME, 'darwin'), 'bin', 'run.js')
      await mkdir(join(bin, '..'), {recursive: true})
      await writeFile(bin, '', 'utf8')
      await symlink(realPrefix, linkedPrefix)
      // npm reports the prefix as invoked (the symlink); the binary resolves
      // under the real directory. Both sides must be resolved to compare.
      await assertUpdatable({argv1: bin, capture: async () => linkedPrefix, platform: 'darwin'})
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('still refuses a binary outside the prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tedi-update-'))
    try {
      const bin = join(dir, 'checkout', 'bin', 'run.js')
      await mkdir(join(bin, '..'), {recursive: true})
      await writeFile(bin, '', 'utf8')
      await assert.rejects(
        assertUpdatable({argv1: bin, capture: async () => join(dir, 'prefix'), platform: 'darwin'}),
        /cannot update this copy/,
      )
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })
})
