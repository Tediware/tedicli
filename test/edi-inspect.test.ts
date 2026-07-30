import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
delete process.env.TEDI_API_KEY

const root = process.cwd()

/**
 * Run the command and report the exit code it would leave behind. A thrown error
 * carries its own; a report that printed and then failed on findings sets
 * `process.exitCode` instead, so stdout is flushed rather than cut off by
 * `process.exit()`.
 */
async function run(args: string[]) {
  process.exitCode = 0
  const result = await runCommand(args, {root}, {stripAnsi: true})
  const thrown = (result.error as {oclif?: {exit?: number}} | undefined)?.oclif?.exit
  return {...result, exit: thrown ?? Number(process.exitCode ?? 0)}
}

// Synthetic 837 fragment (no real data, tedi:synthetic-data-ok). MBR123456789 is
// the marker the obfuscation assertions look for.
const INTERCHANGE = [
  'ISA*00*          *00*          *ZZ*SENDERID12345  *ZZ*RECEIVERID1234 *240101*1200*>*00501*000000001*0*T*:',
  'GS*HC*SENDERID*RECEIVERID*20240101*1200*1*X*005010X222A1',
  'ST*837*0001*005010X222A1',
  'NM1*IL*1*DOE*JANE*Q***MI*MBR123456789',
  'SE*4*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n')

const realFetch = globalThis.fetch

interface Sent {
  url: string
  method: string
  body: Record<string, string>
}

/** Findings headers for a healthy run: every check ran, nothing was found. */
const CLEAN: Record<string, string> = {
  'x-edi-findings-errors': '0',
  'x-edi-findings-notices': '0',
  'x-edi-inspection-complete': 'true',
}

/** Findings headers for a run that found things (and ran every check). */
const found = (errors: number, notices = 0): Record<string, string> => ({
  ...CLEAN,
  'x-edi-findings-errors': String(errors),
  'x-edi-findings-notices': String(notices),
})

/**
 * Stub global fetch so the command exercises the real HTTP client (the mock
 * backend would hide what actually goes over the wire, which is the whole point
 * of the --obfuscate assertions).
 *
 * A 200 carries the findings headers unless the test says otherwise; a non-200
 * carries none, as the server sends none.
 */
function stubFetch(response: {status?: number; body?: string; headers?: Record<string, string>} = {}): Sent[] {
  const sent: Sent[] = []
  const status = response.status ?? 200
  const headers = response.headers ?? (status === 200 ? CLEAN : undefined)
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: input.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    })
    return new Response(response.body ?? 'INSPECTION REPORT', {status, headers})
  }) as typeof fetch
  return sent
}


describe('edi inspect', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tedi-inspect-'))
    file = join(dir, 'claims.edi')
    await writeFile(file, INTERCHANGE, 'utf8')
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({token: 'sk-test-1234'}), 'utf8')
    process.env.TEDI_CONFIG_DIR = dir
    // Belt and braces: even with fetch stubbed, never point a test at production.
    process.env.TEDI_API_BASE_URL = 'http://127.0.0.1:1'
    process.env.TEDI_API_MOCK = '0'
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    // oclif's flag-parse failures (see the --seed case) set the process exit code
    // even though runCommand hands the error back; clear it so the test file's own
    // exit status reflects the assertions, not the CLI's.
    process.exitCode = 0
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_BASE_URL
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('scrubs the payload by default, and prints the rendered report', async () => {
    const sent = stubFetch()
    const {stdout, stderr, error} = await run(['edi', 'inspect', file])

    assert.equal(error, undefined)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'http://127.0.0.1:1/api/edi/inspect')
    assert.equal(sent[0].method, 'POST')
    assert.equal(sent[0].body.variant, 'console')
    assert.match(stdout, /INSPECTION REPORT/)

    // No flag was passed: forgetting one must never be what uploads personal data.
    const uploaded = sent[0].body.edi_content
    assert.ok(!uploaded.includes('MBR123456789'), 'member id must not reach the server')
    assert.ok(!uploaded.includes('JANE'), 'given name must not reach the server')
    // Structure is preserved, so the report still describes the original file.
    assert.ok(uploaded.startsWith('ISA*00*'))
    assert.equal(uploaded.length, INTERCHANGE.length)
    assert.match(stderr, /Obfuscated \d+ values across \d+ segments before upload\./)
  })

  it('--seed makes the uploaded replacements reproducible', async () => {
    const first = stubFetch()
    await run(['edi', 'inspect', file, '--seed', 's'])
    const second = stubFetch()
    await run(['edi', 'inspect', file, '--seed', 's'])
    assert.equal(first[0].body.edi_content, second[0].body.edi_content)
  })

  it('--no-obfuscate uploads the file verbatim, and says so', async () => {
    const sent = stubFetch()
    const {stderr, error} = await run(['edi', 'inspect', file, '--no-obfuscate'])

    assert.equal(error, undefined)
    assert.equal(sent[0].body.edi_content, INTERCHANGE)
    assert.match(stderr, /verbatim \(--no-obfuscate\)/)
  })

  it('scrubs input piped in on stdin, same as a file', async () => {
    // The advertised `cat claims.edi | tedi edi inspect -` path goes through a
    // different reader; the default must protect it just the same.
    const sent = stubFetch()
    const realStdin = process.stdin
    Object.defineProperty(process, 'stdin', {value: Readable.from([INTERCHANGE]), configurable: true})
    try {
      await run(['edi', 'inspect', '-'])
    } finally {
      Object.defineProperty(process, 'stdin', {value: realStdin, configurable: true})
    }

    assert.equal(sent.length, 1)
    assert.ok(!sent[0].body.edi_content.includes('MBR123456789'))
    assert.equal(sent[0].body.edi_content.length, INTERCHANGE.length)
  })

  it('refuses an oversized document before scrubbing or uploading it', async () => {
    const sent = stubFetch()
    const huge = join(dir, 'huge.edi')
    await writeFile(huge, INTERCHANGE + 'X'.repeat(256 * 1024), 'utf8')

    const {stderr, error} = await run(['edi', 'inspect', huge])
    assert.match(error?.message ?? '', /accepts up to 256 KB/)
    assert.equal(sent.length, 0)
    // The scrub is length-preserving, so it was never going to help: the run
    // must not report a scrub it then throws away.
    assert.doesNotMatch(stderr, /Obfuscated/)
  })

  it('sends the requested variant', async () => {
    const sent = stubFetch()
    await run(['edi', 'inspect', file, '--format', 'markdown'])
    assert.equal(sent[0].body.variant, 'markdown')
  })

  it('surfaces the server diagnosis when the document cannot be inspected', async () => {
    stubFetch({
      status: 422,
      body: JSON.stringify({error: 'Interchange ends without an IEA segment.', code: 'unparseable_document'}),
    })
    const {error, exit} = await run(['edi', 'inspect', file])
    assert.match(error?.message ?? '', /ends without an IEA segment/)
    // A verdict on the document, so it exits like a report full of errors.
    assert.equal(exit, 1)
  })

  it('refuses an empty file locally, without uploading it', async () => {
    const sent = stubFetch()
    const empty = join(dir, 'empty.edi')
    await writeFile(empty, '   \n', 'utf8')

    const {error} = await run(['edi', 'inspect', empty])
    assert.match(error?.message ?? '', /nothing to inspect/)
    assert.equal(sent.length, 0)
  })

  describe('exit codes', () => {
    it('exits 0 when every check ran and found nothing', async () => {
      stubFetch()
      const {error, stdout, exit} = await run(['edi', 'inspect', file])
      assert.equal(error, undefined)
      assert.equal(exit, 0)
      assert.match(stdout, /INSPECTION REPORT/)
    })

    it('exits 1 when the inspection found errors, and says how many', async () => {
      stubFetch({headers: found(3, 1)})
      const {error, stdout, stderr, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 1)
      // Nothing is thrown: the exit code rides on process.exitCode so the report
      // is flushed rather than cut off by an immediate process.exit().
      assert.equal(error, undefined)
      // The report is the point of the command: it prints either way.
      assert.match(stdout, /INSPECTION REPORT/)
      assert.match(stderr, /3 errors, 1 notice/)
    })

    it('still exits 1 on findings when a check did not run, noting there may be more', async () => {
      // A crashed check loses findings; it never invents them. Three errors are
      // three errors, and calling that "inconclusive" would bury a real verdict.
      stubFetch({headers: {...found(3), 'x-edi-inspection-complete': 'false'}})
      const {stderr, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 1)
      assert.match(stderr, /3 errors, 0 notices\..*there may be more/)
    })

    it('ignores notices unless --fail-on notice asks for them', async () => {
      stubFetch({headers: found(0, 2)})
      const clean = await run(['edi', 'inspect', file])
      assert.equal(clean.error, undefined)

      stubFetch({headers: found(0, 2)})
      const strict = await run(['edi', 'inspect', file, '--fail-on', 'notice'])
      assert.equal(strict.exit, 1)
      assert.match(strict.stderr, /0 errors, 2 notices.*--fail-on notice/s)
    })

    it('exits 2 when the server says a check did not run, however clean the report looks', async () => {
      // The inspection is fail-soft: a check that crashed takes its findings with
      // it, so zero errors here is not evidence of anything.
      stubFetch({headers: {...CLEAN, 'x-edi-inspection-complete': 'false'}})
      const {stdout, stderr, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
      assert.match(stdout, /INSPECTION REPORT/)
      assert.match(stderr, /at least one check did not run/)
    })

    it('exits 2 when the server reports no findings at all', async () => {
      // An older server. Absence is not zero, so this must not pass a build.
      stubFetch({headers: {}})
      const {stdout, stderr, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
      assert.match(stdout, /INSPECTION REPORT/)
      assert.match(stderr, /did not report what the inspection found/)
    })

    it('exits 2 for an unsupported release: a gap on the server, not a bad document', async () => {
      stubFetch({
        status: 422,
        body: JSON.stringify({error: 'Unsupported X12 release 007030.', code: 'unsupported_release'}),
      })
      const {error, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
      assert.match(error?.message ?? '', /Unsupported X12 release/)
    })

    it('exits 2 for a fault on the server', async () => {
      stubFetch({status: 422, body: JSON.stringify({error: 'Boom.', code: 'inspection_failed'})})
      const {error, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
    })

    it('exits 2 when the command could not run at all', async () => {
      // No key: nothing was learned about the document, so a build must not read
      // this as "the file is bad".
      stubFetch()
      await rm(join(dir, 'credentials.json'))
      const {exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
    })

    it('exits 2 with a readable message when the server cannot be reached', async () => {
      // A refused connection escapes fetch as a bare TypeError, which oclif
      // renders as a stack trace and exits 1 for — telling CI the document is
      // bad when the CLI never got as far as asking.
      globalThis.fetch = (async () => {
        throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'ECONNREFUSED'}})
      }) as typeof fetch

      const {error, exit} = await run(['edi', 'inspect', file])
      assert.equal(exit, 2)
      assert.match(error?.message ?? '', /Could not reach the Tediware API at http:\/\/127\.0\.0\.1:1 \(ECONNREFUSED\)/)
    })

    it('exits 2 when the local scrub cannot read the file: inconclusive, not invalid', async () => {
      // The scrub reads the envelope more strictly than the server's parser, so
      // its refusal is not a verdict on the document — --no-obfuscate is the way
      // forward, and `edi obfuscate` (where the scrub *is* the answer) exits 1.
      const sent = stubFetch()
      const notEdi = join(dir, 'notes.txt')
      await writeFile(notEdi, 'just some text', 'utf8')

      const {error, exit} = await run(['edi', 'inspect', notEdi])
      assert.equal(exit, 2)
      assert.equal(sent.length, 0)
      assert.ok(error?.message.includes("doesn't look like an X12 interchange"))
    })
  })

  it('fails locally, uploading nothing, when the scrub cannot read the file', async () => {
    const sent = stubFetch()
    const notEdi = join(dir, 'notes.txt')
    await writeFile(notEdi, 'just some text', 'utf8')

    const {error} = await run(['edi', 'inspect', notEdi])
    assert.match(error?.message ?? '', /doesn't look like an X12 interchange/)
    assert.equal(sent.length, 0, 'a failed scrub must not fall back to uploading the file')
  })

  it('lets --no-obfuscate reach the server with a file the scrub cannot read', async () => {
    const sent = stubFetch({status: 422, body: JSON.stringify({error: 'No ISA segment.'})})
    const notEdi = join(dir, 'notes.txt')
    await writeFile(notEdi, 'just some text', 'utf8')

    const {error} = await run(['edi', 'inspect', notEdi, '--no-obfuscate'])
    assert.equal(sent.length, 1, 'the opt-out is the escape hatch for an unreadable envelope')
    assert.match(error?.message ?? '', /No ISA segment/)
  })

  it('requires auth, without uploading anything', async () => {
    const sent = stubFetch()
    await rm(join(dir, 'credentials.json'))
    const {error} = await run(['edi', 'inspect', file])
    assert.match(error?.message ?? '', /not signed in/i)
    assert.equal(sent.length, 0)
  })

  it('checks auth before scrubbing, so it never reports work for an upload it cannot make', async () => {
    const sent = stubFetch()
    await rm(join(dir, 'credentials.json'))
    const {error, stderr} = await run(['edi', 'inspect', file])
    // Assert the expected failure, so the absence checks below cannot pass
    // vacuously by way of the command failing earlier for some other reason.
    assert.match(error?.message ?? '', /not signed in/i)
    assert.doesNotMatch(stderr, /before upload/, 'announced a scrub for an upload that never happens')
    assert.equal(sent.length, 0)
  })

  it('fails clearly when the file does not exist', async () => {
    const sent = stubFetch()
    const {error} = await run(['edi', 'inspect', join(dir, 'nope.edi')])
    assert.match(error?.message ?? '', /File not found/)
    assert.equal(sent.length, 0)
  })

  it('rejects --json with an explanation rather than a flat flag error', async () => {
    stubFetch()
    const {error} = await run(['edi', 'inspect', file, '--json'])
    assert.match(error?.message ?? '', /JSON is not offered/)
  })

  it('rejects --seed with --no-obfuscate (it would have no effect)', async () => {
    const sent = stubFetch()
    const {error} = await run(['edi', 'inspect', file, '--seed', 's', '--no-obfuscate'])
    assert.match(error?.message ?? '', /Pass one or the other/)
    assert.equal(sent.length, 0)
  })
})
