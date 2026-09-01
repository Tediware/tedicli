import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
delete process.env.TEDI_API_KEY

const root = process.cwd()
const run = async (args: string[]) => {
  const result = await runCommand(args, {root}, {stripAnsi: true})
  process.exitCode = 0
  return result
}

// Data-plane commands against the mock backend, exercising each command's
// plumbing (flags, rendering, --json) without a live server.
describe('data-plane commands (mock backend)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tedi-platform-'))
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({token: 'sk-test-1234'}), 'utf8')
    process.env.TEDI_CONFIG_DIR = dir
    process.env.TEDI_API_MOCK = '1'
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    delete process.env.TEDI_API_MOCK
    await rm(dir, {recursive: true, force: true})
  })

  it('transaction list renders a table', async () => {
    const {stdout, error} = await run(['transaction', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /ID\s+DIR\s+SET/)
    assert.match(stdout, /mock-txn-1\s+in\s+850/)
  })

  it('transaction list --json returns the page envelope', async () => {
    const {stdout, error} = await run(['transaction', 'list', '--json'])
    assert.equal(error, undefined)
    const page = JSON.parse(stdout)
    assert.equal(page.items[0].id, 'mock-txn-1')
    assert.equal(page.hasMore, false)
  })

  it('transaction list --outgoing filters by direction', async () => {
    const {stdout} = await run(['transaction', 'list', '--outgoing'])
    assert.doesNotMatch(stdout, /mock-txn-1/)
    assert.match(stdout, /mock-txn-2\s+out\s+856/)
  })

  it('transaction get shows envelope, artifacts, and the artifact hint', async () => {
    const {stdout, error} = await run(['transaction', 'get', 'mock-txn-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Direction\s+inbound/)
    assert.match(stdout, /Status\s+delivered/)
    assert.match(stdout, /tedi artifact get/)
    assert.match(stdout, /mock-artifact-1\s+edi/)
  })

  it('transaction get exits 1 for an unknown id', async () => {
    const {error} = await run(['transaction', 'get', 'nope'])
    assert.match(error?.message ?? '', /No transaction 'nope'/)
    assert.equal((error as {oclif?: {exit?: number}})?.oclif?.exit, 1)
  })

  it('transaction logs resolves the trace and prints lines oldest first', async () => {
    const {stdout, error} = await run(['transaction', 'logs', 'mock-txn-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Received document[\s\S]*Delivered to webhook/)
  })

  it('result get shows the steps and artifacts', async () => {
    const {stdout, error} = await run(['result', 'get', 'mock-result-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /EDI Endpoint > EDI to JSON/)
    assert.match(stdout, /mock-artifact-1/)
  })

  it('feed list renders entries', async () => {
    const {stdout, error} = await run(['feed', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /CREATED\s+DIR\s+STATUS/)
    assert.match(stdout, /inbound\s+success\s+ACME/)
  })

  it('artifact get -o writes the bytes to a file', async () => {
    const target = join(dir, 'out.edi')
    const {error} = await run(['artifact', 'get', 'mock-artifact-1', '-o', target])
    assert.equal(error, undefined)
    const written = await readFile(target, 'utf8')
    assert.match(written, /^ISA\*00\*/)
  })

  it('partner send parses JSON input and prints the receipt', async () => {
    const file = join(dir, 'order.json')
    await writeFile(file, JSON.stringify({po: '123'}), 'utf8')
    const {stdout, error} = await run(['partner', 'send', 'ACME', '850', file])
    assert.equal(error, undefined)
    assert.match(stdout, /Processing queued/)
    assert.match(stdout, /mock-trace-outbound/)
  })

  it('partner send rejects a non-JSON document with a receive hint', async () => {
    const file = join(dir, 'raw.edi')
    await writeFile(file, 'ISA*00*...~', 'utf8')
    const {error} = await run(['partner', 'send', 'ACME', '850', file])
    assert.match(error?.message ?? '', /not valid JSON/)
  })

  it('partner receive submits raw EDI and prints the trace', async () => {
    const file = join(dir, 'in.edi')
    await writeFile(file, 'ISA*00*...~', 'utf8')
    const {stdout, error} = await run(['partner', 'receive', 'ACME', file])
    assert.equal(error, undefined)
    assert.match(stdout, /mock-trace-inbound/)
  })

  it('whoami reports the full identity', async () => {
    const {stdout, error} = await run(['whoami'])
    assert.equal(error, undefined)
    assert.match(stdout, /Acme EDI \(dev\) \(scope: standard, key 'Development key' \.\.\.1234\)/)
  })

  it('auth status reports scope and terms', async () => {
    const {stdout, error} = await run(['auth', 'status'])
    assert.equal(error, undefined)
    assert.match(stdout, /Key scope:\s+standard/)
    assert.match(stdout, /Terms:\s+accepted/)
  })
})
