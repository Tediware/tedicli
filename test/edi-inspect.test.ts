import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
delete process.env.TEDI_API_KEY

const root = process.cwd()
const run = (args: string[]) => runCommand(args, {root}, {stripAnsi: true})

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

/**
 * Stub global fetch so the command exercises the real HTTP client (the mock
 * backend would hide what actually goes over the wire, which is the whole point
 * of the --obfuscate assertions).
 */
function stubFetch(response: {status?: number; body?: string} = {}): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: input.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    })
    return new Response(response.body ?? 'INSPECTION REPORT', {status: response.status ?? 200})
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

  it('uploads the file as-is and prints the rendered report', async () => {
    const sent = stubFetch()
    const {stdout, error} = await run(['edi', 'inspect', file])

    assert.equal(error, undefined)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'http://127.0.0.1:1/api/edi/inspect')
    assert.equal(sent[0].method, 'POST')
    assert.equal(sent[0].body.edi_content, INTERCHANGE)
    assert.equal(sent[0].body.variant, 'console')
    assert.match(stdout, /INSPECTION REPORT/)
  })

  it('--obfuscate scrubs the payload before it leaves the machine', async () => {
    const sent = stubFetch()
    const {stderr, error} = await run(['edi', 'inspect', file, '--obfuscate', '--seed', 's'])

    assert.equal(error, undefined)
    const uploaded = sent[0].body.edi_content
    assert.ok(!uploaded.includes('MBR123456789'), 'member id must not reach the server')
    assert.ok(!uploaded.includes('JANE'), 'given name must not reach the server')
    // Structure is preserved, so the report still describes the original file.
    assert.ok(uploaded.startsWith('ISA*00*'))
    assert.equal(uploaded.length, INTERCHANGE.length)
    assert.match(stderr, /Obfuscated \d+ values across \d+ segments before upload\./)
  })

  it('sends the requested variant', async () => {
    const sent = stubFetch()
    await run(['edi', 'inspect', file, '--format', 'markdown'])
    assert.equal(sent[0].body.variant, 'markdown')
  })

  it('surfaces the server diagnosis when the document cannot be inspected', async () => {
    stubFetch({status: 422, body: JSON.stringify({error: 'Interchange ends without an IEA segment.'})})
    const {error} = await run(['edi', 'inspect', file])
    assert.match(error?.message ?? '', /ends without an IEA segment/)
  })

  it('points at the unscrubbed path when local obfuscation cannot parse the file', async () => {
    const sent = stubFetch()
    const notEdi = join(dir, 'notes.txt')
    await writeFile(notEdi, 'just some text', 'utf8')

    const {error} = await run(['edi', 'inspect', notEdi, '--obfuscate'])
    assert.match(error?.message ?? '', /doesn't look like an X12 interchange/)
    assert.equal(sent.length, 0, 'nothing may be uploaded when the scrub fails')
  })

  it('requires auth, without uploading anything', async () => {
    const sent = stubFetch()
    await rm(join(dir, 'credentials.json'))
    const {error} = await run(['edi', 'inspect', file])
    assert.match(error?.message ?? '', /not signed in/i)
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

  it('rejects --seed without --obfuscate (it would have no effect)', async () => {
    stubFetch()
    const {error} = await run(['edi', 'inspect', file, '--seed', 's'])
    assert.ok(error, 'expected --seed to require --obfuscate')
  })
})
