import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after, before, describe, it} from 'node:test'

import {useMock} from '../src/lib/api-client.js'
import {ConfigStore, DEFAULT_X12_RELEASE, isConfigKey} from '../src/lib/config-store.js'
import {FileCredentialStore} from '../src/lib/credentials.js'
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

describe('FileCredentialStore', () => {
  let dir: string

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tedi-creds-'))
  })

  after(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('round-trips a token and stores the file as 0600', async () => {
    const store = new FileCredentialStore(dir)
    await store.set({token: 'sk-secret'})
    const got = await store.get()
    assert.equal(got?.token, 'sk-secret')
    const st = await stat(join(dir, 'credentials.json'))
    assert.equal(st.mode & 0o777, 0o600)
  })

  it('treats a corrupt file as not signed in', async () => {
    const store = new FileCredentialStore(dir)
    await writeFile(join(dir, 'credentials.json'), '{ not json', 'utf8')
    assert.equal(await store.get(), undefined)
  })

  it('treats a file with no token as not signed in', async () => {
    const store = new FileCredentialStore(dir)
    await writeFile(join(dir, 'credentials.json'), '{}', 'utf8')
    assert.equal(await store.get(), undefined)
  })

  it('clears credentials', async () => {
    const store = new FileCredentialStore(dir)
    await store.set({token: 'sk-secret'})
    await store.clear()
    assert.equal(await store.get(), undefined)
  })
})

describe('useMock', () => {
  const original = process.env.TEDI_API_MOCK

  after(() => {
    if (original === undefined) delete process.env.TEDI_API_MOCK
    else process.env.TEDI_API_MOCK = original
  })

  it('defaults to the real API when unset', () => {
    delete process.env.TEDI_API_MOCK
    assert.equal(useMock(), false)
  })

  it('enables the mock only for truthy values', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      process.env.TEDI_API_MOCK = v
      assert.equal(useMock(), true, `expected ${v} to enable the mock`)
    }
  })

  it('uses the real API for empty or falsy values', () => {
    for (const v of ['', '0', 'false', 'no', 'off']) {
      process.env.TEDI_API_MOCK = v
      assert.equal(useMock(), false, `expected ${v} to use the real API`)
    }
  })
})

describe('JsonNotSupportedError', () => {
  it('carries the educational message', () => {
    const err = new JsonNotSupportedError()
    assert.match(err.message, /--format console/)
    assert.match(err.message, /licensed X12 reference data/)
  })
})
