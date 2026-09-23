import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

import {FileCredentialStore} from '../src/lib/credentials.js'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
// Ensure an ambient TEDI_API_KEY in the dev's shell can't perturb auth-state tests.
delete process.env.TEDI_API_KEY

const root = process.cwd()

/**
 * Run the command and report the exit code it would leave behind: a thrown
 * error carries its own, and a `--json` failure sets `process.exitCode`
 * instead so stdout drains.
 */
const run = async (args: string[]) => {
  process.exitCode = 0
  const result = await runCommand(args, {root}, {stripAnsi: true})
  const thrown = (result.error as {oclif?: {exit?: number}} | undefined)?.oclif?.exit
  const exit = thrown ?? Number(process.exitCode ?? 0)
  process.exitCode = 0
  return {...result, exit}
}

/** Swap stdin for a closed, non-TTY stream with the given content. */
async function withStdin<T>(content: string, fn: () => Promise<T>): Promise<T> {
  const realStdin = process.stdin
  Object.defineProperty(process, 'stdin', {value: Readable.from(content === '' ? [] : [content]), configurable: true})
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'stdin', {value: realStdin, configurable: true})
  }
}

async function makeConfigDir(withToken: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tedi-cmd-'))
  if (withToken) {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({token: 'sk-test-1234'}), 'utf8')
  }
  return dir
}

const NO_ROUTE = JSON.stringify({error: {message: 'No such endpoint', code: 'no_route'}})

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

  it('whoami --json is the REST identity shape with no CLI-only fields', async () => {
    const {stdout, error} = await run(['whoami', '--json'])
    assert.equal(error, undefined)
    assert.deepEqual(JSON.parse(stdout), {
      organization: {id: 'mock-org-0000', name: 'Acme EDI (dev)'},
      keyScope: 'standard',
      keyLabel: 'Development key',
      serviceTermsAccepted: true,
    })
  })

  it('x12 seg prints a segment in the server layout and echoes the release', async () => {
    const {stdout, error} = await run(['x12', 'seg', 'N1'])
    assert.equal(error, undefined)
    assert.match(stdout, /^N1 - Synthetic Segment\nRelease: 004010\n/)
  })

  it('x12 seg honors --release', async () => {
    const {stdout} = await run(['x12', 'seg', 'N1', '-r', '005010'])
    assert.match(stdout, /Release: 005010/)
  })

  it('x12 seg uppercases a lowercased id (case-insensitive)', async () => {
    const {stdout, error} = await run(['x12', 'seg', 'n1'])
    assert.equal(error, undefined)
    assert.match(stdout, /^N1 - /)
  })

  it('x12 seg exits 2 for an empty or blank id without asking the server', async () => {
    // oclif reads these as a missing argument; the space-bearing case
    // (`tedi x12 seg "N1 X"`) is refused by referenceId in the command, which
    // the test runner cannot reach because it splits arguments on whitespace.
    for (const blank of ['', '  ']) {
      const {exit} = await run(['x12', 'seg', blank])
      assert.equal(exit, 2)
    }
  })

  it('the legacy "segment" name still works as an alias', async () => {
    const {stdout, error} = await run(['x12', 'segment', 'N1'])
    assert.equal(error, undefined)
    assert.match(stdout, /^N1 - /)
  })

  it('x12 txn uppercases a functional-group form (case-insensitive)', async () => {
    const {stdout, error} = await run(['x12', 'txn', 'sh856'])
    assert.equal(error, undefined)
    assert.match(stdout, /^SH856 - Synthetic Transaction Set/)
  })

  it('x12 ele --format markdown renders markdown', async () => {
    const {stdout} = await run(['x12', 'ele', '235', '--format', 'markdown'])
    assert.match(stdout, /^# 235 - Synthetic Element/m)
  })

  it('x12 ele asks for the whole code list when stdout is not a terminal', async () => {
    // The test runner captures stdout, so this is the piped case: no truncation
    // footer, because nobody is there to act on it.
    const {stdout, error} = await run(['x12', 'ele', '235'])
    assert.equal(error, undefined)
    assert.match(stdout, /EE\s+Example value E/)
    assert.doesNotMatch(stdout, /showing/)
  })

  it('x12 ele --limit truncates even when piped, with the server footer', async () => {
    const {stdout, error} = await run(['x12', 'ele', '235', '--limit', '2'])
    assert.equal(error, undefined)
    assert.match(stdout, /BB\s+Example value B/)
    assert.doesNotMatch(stdout, /CC\s+Example value C/)
    assert.match(stdout, /5 codes; showing 2\. Pass --all for the full list, or pipe the output\./)
  })

  it('x12 ele --all shows every code', async () => {
    const {stdout, error} = await run(['x12', 'ele', '235', '--all'])
    assert.equal(error, undefined)
    assert.match(stdout, /EE\s+Example value E/)
    assert.doesNotMatch(stdout, /showing/)
  })

  it('x12 ele rejects --all together with --limit', async () => {
    const {error} = await run(['x12', 'ele', '235', '--all', '--limit', '2'])
    assert.match(error?.message ?? '', /cannot also be provided|exclusive/i)
  })

  it('x12 ele rejects a limit below 1', async () => {
    const {error} = await run(['x12', 'ele', '235', '--limit', '0'])
    assert.match(error?.message ?? '', /greater than or equal to 1|must be/i)
  })

  it('x12 --json returns the one no-JSON wording, not a flat failure', async () => {
    const {error} = await run(['x12', 'seg', 'N1', '--json'])
    assert.ok(error, 'expected an error')
    assert.match(error!.message, /--json is not offered here: licensed X12 reference data/)
  })

  describe('the X12 licensing notice', () => {
    const NOTICE = /X12 reference content is licensed from X12 Incorporated\. Tediware's Service Terms \(Section 2\.2\(h\)\) prohibit using it to train, ground, or prompt AI systems\./

    async function withStdoutTty<T>(isTTY: boolean, fn: () => Promise<T>): Promise<T> {
      const real = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
      Object.defineProperty(process.stdout, 'isTTY', {value: isTTY, configurable: true})
      try {
        return await fn()
      } finally {
        if (real) Object.defineProperty(process.stdout, 'isTTY', real)
        else delete (process.stdout as {isTTY?: boolean}).isTTY
      }
    }

    for (const [cmd, id] of [['seg', 'N1'], ['ele', '235'], ['txn', '856']]) {
      it(`x12 ${cmd} prints it on stderr when stdout is not a terminal`, async () => {
        const {stdout, stderr, error} = await withStdoutTty(false, () => run(['x12', cmd, id]))
        assert.equal(error, undefined)
        assert.match(stderr, NOTICE)
        assert.doesNotMatch(stdout, NOTICE)
      })

      it(`x12 ${cmd} leaves it off a terminal`, async () => {
        const {stderr, error} = await withStdoutTty(true, () => run(['x12', cmd, id]))
        assert.equal(error, undefined)
        assert.doesNotMatch(stderr, NOTICE)
      })

      it(`x12 ${cmd} --help carries it`, async () => {
        const {stdout} = await run(['x12', cmd, '--help'])
        assert.match(stdout.replace(/\s+/g, ' '), NOTICE)
      })
    }

    it('x12 releases never prints it', async () => {
      const piped = await withStdoutTty(false, () => run(['x12', 'releases']))
      assert.doesNotMatch(piped.stderr, NOTICE)
      const help = await run(['x12', 'releases', '--help'])
      assert.doesNotMatch(help.stdout.replace(/\s+/g, ' '), NOTICE)
    })
  })

  it('config set then get round-trips', async () => {
    const set = await run(['config', 'set', 'x12.release', '006020'])
    assert.equal(set.error, undefined)
    const get = await run(['config', 'get', 'x12.release'])
    assert.match(get.stdout, /006020/)
  })

  it('config get --json and config list --json are offered', async () => {
    const get = await run(['config', 'get', 'x12.release', '--json'])
    assert.deepEqual(JSON.parse(get.stdout), {key: 'x12.release', value: '004010'})
    const list = await run(['config', 'list', '--json'])
    const parsed = JSON.parse(list.stdout) as {configDir: string; entries: {key: string}[]}
    assert.equal(parsed.configDir, dir)
    assert.equal(parsed.entries.length, 2)
  })

  it('config list prints the config dir first', async () => {
    const {stdout} = await run(['config', 'list'])
    assert.match(stdout, new RegExp(`^Config dir: ${dir.replaceAll('\\', '\\\\')}\n`))
  })

  it('config unset removes a stored value and says what applies now', async () => {
    await run(['config', 'set', 'x12.release', '006020'])
    const unset = await run(['config', 'unset', 'x12.release'])
    assert.equal(unset.error, undefined)
    assert.match(unset.stdout, /Unset x12\.release\. Now 004010 \(default\)/)
    const again = await run(['config', 'unset', 'x12.release'])
    assert.match(again.stdout, /was not set/)
  })

  it('config get rejects an unknown key', async () => {
    const {error} = await run(['config', 'get', 'bogus.key'])
    assert.ok(error)
    assert.match(error!.message, /Unknown configuration key/)
  })

  it('config set rejects a value that is not a URL, rather than storing it', async () => {
    const {error} = await run(['config', 'set', 'api.baseUrl', 'not-a-url'])
    assert.ok(error, 'expected an error')
    assert.match(error!.message, /not a valid URL/)
    // The bad value must not have been persisted on the way to failing.
    const get = await run(['config', 'get', 'api.baseUrl'])
    assert.doesNotMatch(get.stdout, /not-a-url/)
  })

  it('config set rejects a non-http scheme', async () => {
    const {error} = await run(['config', 'set', 'api.baseUrl', 'file:///etc/passwd'])
    assert.ok(error)
    assert.match(error!.message, /http or https/)
  })

  it('config set api.baseUrl refuses a path and normalizes a trailing slash', async () => {
    const {error} = await run(['config', 'set', 'api.baseUrl', 'http://localhost:5004/api'])
    assert.match(error?.message ?? '', /carries a path/)
    const ok = await run(['config', 'set', 'api.baseUrl', 'http://localhost:5004/'])
    assert.equal(ok.error, undefined)
    assert.match(ok.stdout, /Set api\.baseUrl = http:\/\/localhost:5004$/m)
  })

  it('config set rejects a malformed release code', async () => {
    const {error} = await run(['config', 'set', 'x12.release', 'not-a-release'])
    assert.ok(error)
    assert.match(error!.message, /six-digit release code/)
  })

  it('an unusable api.baseUrl from the environment fails with a real message, and config list flags it', async () => {
    // config set is not the only way in: TEDI_API_BASE_URL and a hand-edited
    // config.json reach the client directly, where a bad value used to escape as
    // a bare `TypeError: Invalid URL` out of fetch.
    process.env.TEDI_API_BASE_URL = 'not-a-url'
    try {
      const {error} = await run(['x12', 'seg', 'N1'])
      assert.ok(error, 'expected an error')
      assert.match(error!.message, /api\.baseUrl is not a valid URL/)
      assert.doesNotMatch(error!.message, /Invalid URL/)
      const {stdout} = await run(['config', 'list'])
      assert.match(stdout, /api\.baseUrl = not-a-url  \(env\)  INVALID:/)
    } finally {
      delete process.env.TEDI_API_BASE_URL
    }
  })

  it('x12 releases lists releases, marks the default, and offers --json and --format', async () => {
    const {stdout, error} = await run(['x12', 'releases'])
    assert.equal(error, undefined)
    assert.match(stdout, /\* 004010/)
    assert.match(stdout, /^ {4}005010/m)
    const md = await run(['x12', 'releases', '--format', 'markdown'])
    assert.match(md.stdout, /^- \*\*004010\*\* Release 004010 \(default\)/m)
    const json = await run(['x12', 'releases', '--json'])
    assert.equal(JSON.parse(json.stdout).data.releases[0].code, '004010')
  })

  it('x12 releases warns when the configured default is not a release the server carries', async () => {
    const {stdout, stderr} = await run(['x12', 'releases', '-r', '999999'])
    assert.doesNotMatch(stdout, /^ {2}\* \d{6}/m)
    assert.match(stderr, /999999 is not one this server carries/)
  })

  it('edi inspect runs against the mock backend', async () => {
    // The mock is what developers run against with no server and no real key;
    // it must satisfy the same interface, including the auth requirement.
    const file = join(dir, 'mock.edi')
    await writeFile(file, 'ISA*00*          *00*          *ZZ*S              *ZZ*R              *240101*1200*U*00401*000000001*0*T*:~\nIEA*1*000000001~\n', 'utf8')
    const {stdout, error} = await run(['edi', 'inspect', file])
    assert.equal(error, undefined)
    assert.match(stdout, /EDI inspection/)
    assert.match(stdout, /synthetic/)
  })

  it('update takes the target version as a positional argument', async () => {
    // --help loads the command without actually shelling out to npm.
    const {stdout, error} = await run(['update', '--help'])
    assert.equal(error, undefined)
    assert.match(stdout, /through npm/i)
    assert.match(stdout, /update \[VERSION\]/)
    assert.doesNotMatch(stdout, /--version/)
  })

  it('update refuses when the running binary is not an npm global install', async () => {
    const {error, exit} = await run(['update'])
    assert.match(error?.message ?? '', /cannot update this copy/)
    assert.equal(exit, 2)
  })

  it('-h prints help', async () => {
    const {stdout, error} = await run(['whoami', '-h'])
    assert.equal(error, undefined)
    assert.match(stdout, /USAGE/)
  })

  it('a filesystem fault names the path and the reason, exit 2', async () => {
    // A directory where the credentials file should be.
    await rm(join(dir, 'credentials.json'))
    await writeFile(join(dir, 'config.json'), '{}', 'utf8')
    process.env.TEDI_CONFIG_DIR = join(dir, 'config.json')
    const {error, exit} = await run(['auth', 'status'])
    assert.equal(exit, 2)
    assert.match(error?.message ?? '', /Cannot read .*credentials\.json: a component of the path is not a directory/)
  })

  it('an unclassified failure exits 2 with one line and no stack, and as JSON under --json', async () => {
    // A bare Error the client did not classify: the response body read fails
    // after a 200. Left alone, oclif would print a stack and exit 1.
    process.env.TEDI_API_MOCK = '0'
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => {
          throw new Error('socket hang up\n    at TLSSocket.onSocketEnd')
        },
      }) as unknown as Response) as typeof fetch
    try {
      const {error, exit} = await run(['whoami'])
      assert.equal(exit, 2)
      assert.equal(error?.message, 'socket hang up')
      const json = await run(['whoami', '--json'])
      assert.equal(json.exit, 2)
      assert.deepEqual(JSON.parse(json.stdout), {error: {message: 'socket hang up', code: null, suggestions: [], exitCode: 2}})
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('--json errors print the one JSON shape on stdout and set the exit code', async () => {
    const {stdout, exit, error} = await run(['transaction', 'get', 'nope', '--json'])
    assert.equal(error, undefined)
    assert.equal(exit, 1)
    const parsed = JSON.parse(stdout)
    assert.deepEqual(Object.keys(parsed.error), ['message', 'code', 'suggestions', 'exitCode'])
    assert.match(parsed.error.message, /No transaction 'nope'/)
    assert.equal(parsed.error.code, 'not_found')
    assert.equal(parsed.error.exitCode, 1)
  })

  it('--json errors cover oclif parse failures too', async () => {
    const {stdout, exit} = await run(['transaction', 'list', '--limit', '500', '--json'])
    assert.equal(exit, 2)
    const parsed = JSON.parse(stdout)
    assert.match(parsed.error.message, /less than or equal to 100/)
    assert.equal(parsed.error.exitCode, 2)
  })
})

describe('--profile', () => {
  let home: string
  const realHome = process.env.HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'tedi-home-'))
    process.env.HOME = home
    delete process.env.XDG_CONFIG_HOME
    process.env.TEDI_API_MOCK = '1'
  })

  afterEach(async () => {
    process.env.HOME = realHome
    delete process.env.TEDI_API_MOCK
    await rm(home, {recursive: true, force: true})
  })

  it('reads and writes config and credentials under ~/.tedi-profiles/<name>', async () => {
    const set = await run(['config', 'set', 'x12.release', '005010', '--profile', 'staging'])
    assert.equal(set.error, undefined)
    const stored = JSON.parse(await readFile(join(home, '.tedi-profiles', 'staging', 'config.json'), 'utf8'))
    assert.equal(stored['x12.release'], '005010')

    const list = await run(['config', 'list', '--profile', 'staging'])
    assert.match(list.stdout, new RegExp(`Config dir: .*${join('.tedi-profiles', 'staging')}`))

    await withStdin('sk-staging-7777\n', () => run(['auth', 'login', '--profile', 'staging', '--no-verify']))
    const creds = await new FileCredentialStore(join(home, '.tedi-profiles', 'staging')).get()
    assert.equal(creds?.token, 'sk-staging-7777')
  })

  it('refuses a profile name that could leave the directory', async () => {
    const {error} = await run(['config', 'list', '--profile', '../x'])
    assert.match(error?.message ?? '', /Invalid profile name/)
  })
})

describe('commands against the real client when identity is unavailable', () => {
  // Whoami performs a real request, so stub fetch with a JSON routing 404 (a
  // server older than /platform/whoami) to keep these hermetic with the mock
  // disabled.
  let dir: string
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    dir = await makeConfigDir(true)
    process.env.TEDI_CONFIG_DIR = dir
    process.env.TEDI_API_MOCK = '0'
    globalThis.fetch = (async () => new Response(NO_ROUTE, {status: 404})) as typeof fetch
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_MOCK
    globalThis.fetch = realFetch
    await rm(dir, {recursive: true, force: true})
  })

  it('whoami degrades to reporting the locally-known key', async () => {
    const {stdout, error} = await run(['whoami'])
    assert.equal(error, undefined)
    assert.match(stdout, /key is present \(\.\.\.1234\)/)
    assert.match(stdout, /does not report identity/i)
  })

  it('auth status confirms a stored key without the identity endpoint', async () => {
    const {stdout, error} = await run(['auth', 'status'])
    assert.equal(error, undefined)
    assert.match(stdout, /Signed in\./)
    assert.match(stdout, /Key:\s+\(unnamed\) \.\.\.1234/)
    assert.match(stdout, /Source:\s+stored/)
  })

  it('an HTML 404 is a wrong base URL, not an older server', async () => {
    globalThis.fetch = (async () => new Response('<html>Not Found</html>', {status: 404})) as typeof fetch
    const {error, exit} = await run(['whoami'])
    assert.match(error?.message ?? '', /No such endpoint at/)
    assert.equal(exit, 2)
  })

  it('a non-JSON 2xx is reported as such, exit 2', async () => {
    globalThis.fetch = (async () => new Response('<html>login</html>', {status: 200, headers: {'content-type': 'text/html'}})) as typeof fetch
    const {error, exit} = await run(['whoami'])
    assert.match(error?.message ?? '', /did not answer with JSON \(text\/html\)/)
    assert.equal(exit, 2)
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
    assert.match(stdout, /^N1 - /)
  })

  it('auth login persists the env key when stdin is empty, and verifies it', async () => {
    const {stdout, error} = await withStdin('', () => run(['auth', 'login']))
    assert.equal(error, undefined)
    assert.match(stdout, /Using TEDI_API_KEY/)
    assert.match(stdout, /Signed in to Acme EDI \(dev\)/)
    const stored = await new FileCredentialStore(dir).get()
    assert.equal(stored?.token, 'sk-env-9999')
  })

  it('auth login prefers a piped key over the environment, and takes the first non-empty line', async () => {
    const {error} = await withStdin('\nsk-piped-1111\nsecond line\n', () => run(['auth', 'login', '--no-verify']))
    assert.equal(error, undefined)
    const stored = await new FileCredentialStore(dir).get()
    assert.equal(stored?.token, 'sk-piped-1111')
  })

  it('auth login refuses a key with control characters', async () => {
    const {error} = await withStdin('sk-bad\tkey\n', () => run(['auth', 'login', '--no-verify']))
    assert.match(error?.message ?? '', /control characters/)
    assert.equal(await new FileCredentialStore(dir).get(), undefined)
  })

  it('auth status names the env source', async () => {
    const {stdout, error} = await run(['auth', 'status'])
    assert.equal(error, undefined)
    assert.match(stdout, /Key:\s+Development key \.\.\.9999/)
    assert.match(stdout, /Source:\s+TEDI_API_KEY/)
    const json = await run(['auth', 'status', '--json'])
    assert.equal(JSON.parse(json.stdout).source, 'env')
  })
})

describe('commands (unauthenticated)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeConfigDir(false)
    process.env.TEDI_CONFIG_DIR = dir
    process.env.TEDI_API_MOCK = '1'
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('x12 seg requires auth, and the hint names the configured server', async () => {
    process.env.TEDI_API_BASE_URL = 'http://localhost:5004'
    try {
      const {error} = await run(['x12', 'seg', 'N1'])
      assert.ok(error)
      assert.match(error!.message, /not signed in/i)
      assert.match((error as {suggestions?: string[]}).suggestions?.join(' ') ?? '', /localhost:5004\/app\/api-keys/)
    } finally {
      delete process.env.TEDI_API_BASE_URL
    }
  })

  it('x12 releases works without a key', async () => {
    const {stdout, error} = await run(['x12', 'releases'])
    assert.equal(error, undefined)
    assert.match(stdout, /004010/)
  })

  it('auth status exits 2 when not signed in', async () => {
    const {error, exit} = await run(['auth', 'status'])
    assert.match(error?.message ?? '', /Not signed in/i)
    assert.equal(exit, 2)
  })

  it('mcp serve refuses to start without a key, before reading stdin', async () => {
    const {stdout, error} = await run(['mcp', 'serve'])
    assert.ok(error)
    assert.match(error!.message, /not signed in/i)
    // Nothing but MCP messages may reach stdout, so a refusal leaves it empty.
    assert.equal(stdout, '')
  })
})
