import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

import {FileCredentialStore} from '../src/lib/credentials.js'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
// Ensure an ambient TEDI_API_KEY in the dev's shell can't perturb auth-state tests.
delete process.env.TEDI_API_KEY

const root = process.cwd()
const run = (args: string[]) => runCommand(args, {root}, {stripAnsi: true})

async function makeConfigDir(withToken: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tedi-cmd-'))
  if (withToken) {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({token: 'sk-test-1234'}), 'utf8')
  }
  return dir
}

describe('commands (authenticated)', () => {
  let dir: string

  // Fresh config dir per test so a `config set` in one test cannot leak into
  // another (the suite must not be order-dependent).
  beforeEach(async () => {
    dir = await makeConfigDir(true)
    process.env.TEDI_CONFIG_DIR = dir
    // These tests assert against the mock backend's synthetic data; opt into it
    // now that the real API is the default.
    process.env.TEDI_API_MOCK = '1'
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('whoami reports the mock identity', async () => {
    const {stdout, error} = await run(['whoami'])
    assert.equal(error, undefined)
    assert.match(stdout, /Acme EDI/)
  })

  it('x12 seg prints a segment and echoes the release', async () => {
    const {stdout, error} = await run(['x12', 'seg', 'N1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Segment N1/)
    assert.match(stdout, /004010/)
  })

  it('x12 seg honors --release', async () => {
    const {stdout} = await run(['x12', 'seg', 'N1', '-r', '005010'])
    assert.match(stdout, /005010/)
  })

  it('x12 seg uppercases a lowercased id (case-insensitive)', async () => {
    const {stdout, error} = await run(['x12', 'seg', 'n1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Segment N1/)
  })

  it('the legacy "segment" name still works as an alias', async () => {
    const {stdout, error} = await run(['x12', 'segment', 'N1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Segment N1/)
  })

  it('x12 txn uppercases a functional-group form (case-insensitive)', async () => {
    const {stdout, error} = await run(['x12', 'txn', 'sh856'])
    assert.equal(error, undefined)
    assert.match(stdout, /Transaction Set SH856/)
  })

  it('x12 ele --format markdown renders markdown', async () => {
    const {stdout} = await run(['x12', 'ele', '235', '--format', 'markdown'])
    assert.match(stdout, /^# Element 235/m)
  })

  it('x12 --json returns the educational error, not a flat failure', async () => {
    const {error} = await run(['x12', 'seg', 'N1', '--json'])
    assert.ok(error, 'expected an error')
    assert.match(error!.message, /Structured JSON isn't offered/)
  })

  it('config set then get round-trips', async () => {
    const set = await run(['config', 'set', 'x12.release', '006020'])
    assert.equal(set.error, undefined)
    const get = await run(['config', 'get', 'x12.release'])
    assert.match(get.stdout, /006020/)
  })

  it('config get rejects an unknown key', async () => {
    const {error} = await run(['config', 'get', 'bogus.key'])
    assert.ok(error)
    assert.match(error!.message, /Unknown configuration key/)
  })

  it('x12 releases lists supported releases', async () => {
    const {stdout, error} = await run(['x12', 'releases'])
    assert.equal(error, undefined)
    assert.match(stdout, /004010/)
    assert.match(stdout, /005010/)
  })

  it('update command is registered with a --version flag (npm-native)', async () => {
    // --help loads the command without actually shelling out to npm.
    const {stdout, error} = await run(['update', '--help'])
    assert.equal(error, undefined)
    assert.match(stdout, /installs via npm/i)
    assert.match(stdout, /--version/)
  })
})

describe('commands against the real client when identity is unavailable', () => {
  // The HTTP client's whoami throws IdentityUnavailableError before any network
  // call, so these run hermetically with the mock disabled and no live server.
  let dir: string

  beforeEach(async () => {
    dir = await makeConfigDir(true)
    process.env.TEDI_CONFIG_DIR = dir
    process.env.TEDI_API_MOCK = '0'
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('whoami degrades to reporting the locally-known key', async () => {
    const {stdout, error} = await run(['whoami'])
    assert.equal(error, undefined)
    assert.match(stdout, /key is present \(\.\.\.1234\)/)
    assert.match(stdout, /not available yet/i)
  })

  it('auth status confirms a stored key without the identity endpoint', async () => {
    const {stdout, error} = await run(['auth', 'status'])
    assert.equal(error, undefined)
    assert.match(stdout, /Signed in \(key \.\.\.1234\)/)
  })
})

describe('TEDI_API_KEY environment credential', () => {
  // A key in the environment authenticates without `tedi auth login` and without
  // a stored credential file.
  let dir: string

  beforeEach(async () => {
    dir = await makeConfigDir(false) // no stored credential
    process.env.TEDI_CONFIG_DIR = dir
    process.env.TEDI_API_KEY = 'sk-env-9999'
    // The x12 assertion below checks mock output; opt into the mock backend.
    process.env.TEDI_API_MOCK = '1'
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_KEY
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('authenticates x12 commands with no stored key', async () => {
    const {stdout, error} = await run(['x12', 'seg', 'N1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Segment N1/)
  })

  it('auth login persists the env key to the credential store', async () => {
    const {error} = await run(['auth', 'login'])
    assert.equal(error, undefined)
    const stored = await new FileCredentialStore(dir).get()
    assert.equal(stored?.token, 'sk-env-9999')
  })

  it('auth status notes the env source when identity is unavailable', async () => {
    process.env.TEDI_API_MOCK = '0'
    try {
      const {stdout, error} = await run(['auth', 'status'])
      assert.equal(error, undefined)
      assert.match(stdout, /Signed in \(key \.\.\.9999\) \(from TEDI_API_KEY\)/)
    } finally {
      delete process.env.TEDI_API_MOCK
    }
  })
})

describe('commands (unauthenticated)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeConfigDir(false)
    process.env.TEDI_CONFIG_DIR = dir
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    await rm(dir, {recursive: true, force: true})
  })

  it('x12 seg requires auth', async () => {
    const {error} = await run(['x12', 'seg', 'N1'])
    assert.ok(error)
    assert.match(error!.message, /not signed in/i)
  })

  it('x12 releases requires auth', async () => {
    const {error} = await run(['x12', 'releases'])
    assert.ok(error)
    assert.match(error!.message, /not signed in/i)
  })

  it('auth status reports signed-out', async () => {
    const {stdout, error} = await run(['auth', 'status'])
    assert.equal(error, undefined)
    assert.match(stdout, /Not signed in/i)
  })
})
