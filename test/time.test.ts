import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after, before, describe, it} from 'node:test'

import {assertValidBaseUrl, ConfigStore, profileDir} from '../src/lib/config-store.js'
import {TediError} from '../src/lib/errors.js'
import {isTextContentType} from '../src/lib/output.js'
import {describeForeignInstall, globalPackageDir} from '../src/lib/self-update.js'
import {formatTime} from '../src/lib/table.js'
import {parseSince} from '../src/lib/time.js'

const NOW = new Date('2026-08-19T13:21:19.500Z')

describe('parseSince', () => {
  it('accepts an ISO 8601 timestamp with a zone and normalizes it to UTC', () => {
    assert.equal(parseSince('2026-08-19T13:21:19Z', NOW), '2026-08-19T13:21:19.000Z')
    assert.equal(parseSince('2026-08-19T15:21:19+02:00', NOW), '2026-08-19T13:21:19.000Z')
    assert.equal(parseSince('2026-08-19 13:21:19Z', NOW), '2026-08-19T13:21:19.000Z')
  })

  it('reads a bare date as UTC midnight', () => {
    assert.equal(parseSince('2026-08-19', NOW), '2026-08-19T00:00:00.000Z')
  })

  it('accepts relative forms', () => {
    assert.equal(parseSince('30m', NOW), '2026-08-19T12:51:19.500Z')
    assert.equal(parseSince('2h', NOW), '2026-08-19T11:21:19.500Z')
    assert.equal(parseSince('3d', NOW), '2026-08-16T13:21:19.500Z')
  })

  it('refuses a zone-less datetime with a hint, rather than letting the server guess', () => {
    assert.throws(() => parseSince('2026-08-19T13:21:19', NOW), (err: TediError) => {
      assert.match(err.message, /names no time zone/)
      assert.ok(err.suggestions.some((s) => s.includes('2026-08-19T13:21:19Z')))
      return true
    })
  })

  it('refuses garbage and impossible dates', () => {
    assert.throws(() => parseSince('yesterday', NOW), /was not understood/)
    assert.throws(() => parseSince('2026-13-45', NOW), /not a valid date/)
    assert.throws(() => parseSince('', NOW), /it is empty/)
    assert.throws(() => parseSince('99999999999999999999d', NOW), /further back than time goes/)
  })
})

describe('formatTime', () => {
  it('renders seconds and the UTC marker, dropping sub-second digits', () => {
    assert.equal(formatTime('2026-08-19T13:21:18.812420000Z'), '2026-08-19 13:21:18Z')
    assert.equal(formatTime('2026-08-19T15:21:18+02:00'), '2026-08-19 13:21:18Z')
  })

  it('leaves an unparsable value alone and renders null as a dash', () => {
    assert.equal(formatTime('soon'), 'soon')
    assert.equal(formatTime(null), '-')
  })
})

describe('profileDir', () => {
  it('resolves under ~/.tedi-profiles by default and under XDG_CONFIG_HOME when set', () => {
    assert.equal(profileDir('staging', {}, '/home/u'), '/home/u/.tedi-profiles/staging')
    assert.equal(profileDir('staging', {XDG_CONFIG_HOME: '/xdg'}, '/home/u'), '/xdg/tedi-profiles/staging')
  })

  it('refuses a name that could escape the directory', () => {
    assert.throws(() => profileDir('../etc', {}, '/home/u'), /Invalid profile name/)
    assert.throws(() => profileDir('', {}, '/home/u'), /Invalid profile name/)
  })
})

describe('assertValidBaseUrl', () => {
  it('normalizes a trailing slash away', () => {
    assert.equal(assertValidBaseUrl('http://localhost:5004/'), 'http://localhost:5004')
    assert.equal(assertValidBaseUrl('https://tediware.com'), 'https://tediware.com')
  })

  it('refuses a path, a query and userinfo, naming the fix', () => {
    assert.throws(() => assertValidBaseUrl('http://localhost:5004/api'), (err: TediError) => {
      assert.match(err.message, /carries a path \(\/api\)/)
      assert.ok(err.suggestions.some((s) => s.includes('http://localhost:5004')))
      return true
    })
    assert.throws(() => assertValidBaseUrl('https://tediware.com/?x=1'), /query string/)
    assert.throws(() => assertValidBaseUrl('https://user:pw@tediware.com'), /username or password/)
  })
})

describe('ConfigStore validation', () => {
  let dir: string

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tedi-cfg-'))
  })

  after(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('reports a non-string value in config.json with the key and file', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({'api.baseUrl': 42}), 'utf8')
    await assert.rejects(new ConfigStore(dir).get('api.baseUrl'), /non-string value for api\.baseUrl/)
  })

  it('flags an unusable environment override in list()', async () => {
    await writeFile(join(dir, 'config.json'), '{}', 'utf8')
    process.env.TEDI_API_BASE_URL = 'garbage'
    try {
      const entry = (await new ConfigStore(dir).list()).find((e) => e.key === 'api.baseUrl')
      assert.equal(entry?.source, 'env')
      assert.match(entry?.problem ?? '', /not a valid URL/)
    } finally {
      delete process.env.TEDI_API_BASE_URL
    }
  })

  it('unset reports whether anything was there', async () => {
    const store = new ConfigStore(dir)
    await store.set('x12.release', '005010')
    assert.equal(await store.unset('x12.release'), true)
    assert.equal(await store.unset('x12.release'), false)
  })
})

describe('isTextContentType', () => {
  it('knows EDI, JSON and XML as text and the rest as binary', () => {
    assert.equal(isTextContentType('application/edi-x12'), true)
    assert.equal(isTextContentType('application/json; charset=utf-8'), true)
    assert.equal(isTextContentType('text/plain'), true)
    assert.equal(isTextContentType('application/pdf'), false)
    assert.equal(isTextContentType('application/octet-stream'), false)
    assert.equal(isTextContentType(null), false)
  })
})

describe('describeForeignInstall', () => {
  const prefix = '/usr/local'
  const pkg = '@tediware/tedi'

  it('accepts a binary inside the global prefix', () => {
    const real = `${globalPackageDir(prefix, pkg, 'darwin')}/bin/run.js`
    assert.equal(describeForeignInstall(real, real, prefix, pkg, 'darwin'), undefined)
  })

  it('names a wrapper or checkout, a symlink into a checkout, and a different prefix', () => {
    assert.match(describeForeignInstall('/home/u/tedicli/bin/run.js', '/home/u/tedicli/bin/run.js', prefix, pkg, 'darwin') ?? '', /not an npm install \(a wrapper or a checkout\)/)
    assert.match(describeForeignInstall('/home/u/.local/bin/tedi', '/home/u/tedicli/bin/run.js', prefix, pkg, 'darwin') ?? '', /is a link to \/home\/u\/tedicli\/bin\/run.js/)
    const other = `${globalPackageDir('/home/u/.nvm/versions/node/v20/', pkg, 'darwin')}/bin/run.js`
    assert.match(describeForeignInstall(other, other, prefix, pkg, 'darwin') ?? '', /npm's global prefix is \/usr\/local/)
  })
})
