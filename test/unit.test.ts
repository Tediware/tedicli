import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after, before, describe, it} from 'node:test'

import {ConfigStore, DEFAULT_X12_RELEASE, isConfigKey} from '../src/lib/config-store.js'
import {JsonNotSupportedError} from '../src/lib/errors.js'
import {wantsColor} from '../src/lib/output.js'

describe('wantsColor', () => {
  it('never requests color for markdown', () => {
    assert.equal(wantsColor('markdown', {isTty: true}), false)
  })

  it('requests color for console on a TTY', () => {
    delete process.env.NO_COLOR
    assert.equal(wantsColor('console', {isTty: true}), true)
  })

  it('does not request color when piped (no TTY)', () => {
    assert.equal(wantsColor('console', {isTty: false}), false)
  })

  it('respects --no-color', () => {
    assert.equal(wantsColor('console', {isTty: true, noColorFlag: true}), false)
  })

  it('respects NO_COLOR env', () => {
    process.env.NO_COLOR = '1'
    assert.equal(wantsColor('console', {isTty: true}), false)
    delete process.env.NO_COLOR
  })
})

describe('config keys', () => {
  it('recognizes known keys', () => {
    assert.equal(isConfigKey('x12.release'), true)
    assert.equal(isConfigKey('api.baseUrl'), true)
  })

  it('rejects unknown keys', () => {
    assert.equal(isConfigKey('nope.nope'), false)
  })
})

describe('ConfigStore', () => {
  let dir: string

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tedi-test-'))
  })

  after(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('returns the default release when unset', async () => {
    delete process.env.TEDI_X12_RELEASE
    const store = new ConfigStore(dir)
    assert.equal(await store.get('x12.release'), DEFAULT_X12_RELEASE)
  })

  it('persists and reads back a value', async () => {
    const store = new ConfigStore(dir)
    await store.set('x12.release', '005010')
    const fresh = new ConfigStore(dir)
    assert.equal(await fresh.get('x12.release'), '005010')
  })

  it('lets an env override win over the persisted value', async () => {
    const store = new ConfigStore(dir)
    await store.set('x12.release', '005010')
    process.env.TEDI_X12_RELEASE = '006020'
    assert.equal(await store.get('x12.release'), '006020')
    const entry = (await store.list()).find((e) => e.key === 'x12.release')
    assert.equal(entry?.source, 'env')
    delete process.env.TEDI_X12_RELEASE
  })
})

describe('JsonNotSupportedError', () => {
  it('carries the educational message', () => {
    const err = new JsonNotSupportedError()
    assert.match(err.message, /--format console/)
    assert.match(err.message, /licensed X12 reference data/)
  })
})
