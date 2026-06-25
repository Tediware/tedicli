import assert from 'node:assert/strict'
import {describe, it} from 'node:test'

import {npmInstallArgs, PACKAGE_NAME, selfUpdate} from '../src/lib/self-update.js'

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
