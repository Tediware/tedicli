import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
delete process.env.TEDI_API_KEY

const root = process.cwd()
const run = async (args: string[]) => {
  process.exitCode = 0
  const result = await runCommand(args, {root}, {stripAnsi: true})
  const thrown = (result.error as {oclif?: {exit?: number}} | undefined)?.oclif?.exit
  const exit = thrown ?? Number(process.exitCode ?? 0)
  process.exitCode = 0
  return {...result, exit}
}

async function withStdin<T>(content: string, fn: () => Promise<T>): Promise<T> {
  const realStdin = process.stdin
  Object.defineProperty(process, 'stdin', {value: Readable.from([content]), configurable: true})
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'stdin', {value: realStdin, configurable: true})
  }
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

  it('transaction list renders a table with inbound|outbound, the partner, and second-precision UTC times', async () => {
    const {stdout, error} = await run(['transaction', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /ID\s+DIRECTION\s+SET\s+PARTNER\s+ICN\s+STATUS\s+ACK\s+CREATED/)
    assert.match(stdout, /mock-txn-1\s+inbound\s+850\s+ACME\s+000000001\s+delivered\s+n\/a\s+2026-01-01 12:00:00Z/)
  })

  it('transaction list --json is the REST envelope', async () => {
    const {stdout, error} = await run(['transaction', 'list', '--json'])
    assert.equal(error, undefined)
    const page = JSON.parse(stdout)
    assert.equal(page.ediTransactions[0].id, 'mock-txn-1')
    assert.deepEqual(page.pagination, {hasMore: false, nextCursor: null})
    assert.equal(page.items, undefined)
  })

  it('transaction list --direction filters, and --incoming/--outgoing are gone', async () => {
    const {stdout} = await run(['transaction', 'list', '--direction', 'outbound'])
    assert.doesNotMatch(stdout, /mock-txn-1/)
    assert.match(stdout, /mock-txn-2\s+outbound\s+856/)
    const {error} = await run(['transaction', 'list', '--outgoing'])
    assert.match(error?.message ?? '', /Nonexistent flag/)
  })

  it('transaction list --status filters and refuses other words', async () => {
    const errored = await run(['transaction', 'list', '--status', 'error'])
    assert.match(errored.stdout, /No transactions match\./)
    const delivered = await run(['transaction', 'list', '--status', 'delivered'])
    assert.match(delivered.stdout, /mock-txn-1/)
    const {error} = await run(['transaction', 'list', '--status', 'errored'])
    assert.match(error?.message ?? '', /Expected --status=errored to be one of: delivered, error/)
  })

  it('transaction list --set filters, with --ts as a hidden alias', async () => {
    const set = await run(['transaction', 'list', '--set', '856'])
    assert.doesNotMatch(set.stdout, /mock-txn-1/)
    const ts = await run(['transaction', 'list', '--ts', '856'])
    assert.equal(ts.stdout, set.stdout)
    const help = await run(['transaction', 'list', '--help'])
    assert.doesNotMatch(help.stdout, /--ts/)
  })

  it('transaction list shows the warning count beside the status, never as the status', async () => {
    const {stdout, error} = await run(['transaction', 'list'])
    assert.equal(error, undefined)
    // The warning is its own axis: the document still reads delivered.
    assert.match(stdout, /mock-txn-2\s+outbound\s+856\s+ACME\s+000000002\s+delivered \(1 warning\)\s+accepted/)
    assert.match(stdout, /mock-txn-1\s+inbound\s+850\s+ACME\s+000000001\s+delivered\s+n\/a/)
    assert.doesNotMatch(stdout, /^\s*ID.*\bWARN/m)
  })

  it('transaction list --warnings and --no-warnings are the two filters', async () => {
    const withWarnings = await run(['transaction', 'list', '--warnings'])
    assert.equal(withWarnings.error, undefined)
    assert.match(withWarnings.stdout, /mock-txn-2/)
    assert.doesNotMatch(withWarnings.stdout, /mock-txn-1/)

    const without = await run(['transaction', 'list', '--no-warnings'])
    assert.match(without.stdout, /mock-txn-1/)
    assert.doesNotMatch(without.stdout, /mock-txn-2/)

    // Omitted is not the same as false: both rows come back.
    const both = await run(['transaction', 'list'])
    assert.match(both.stdout, /mock-txn-1/)
    assert.match(both.stdout, /mock-txn-2/)
  })

  it('transaction list --json carries warningCount on every row', async () => {
    const {stdout, error} = await run(['transaction', 'list', '--json'])
    assert.equal(error, undefined)
    const rows = JSON.parse(stdout).ediTransactions
    assert.deepEqual(
      rows.map((t: {id: string; warningCount: number}) => [t.id, t.warningCount]),
      [['mock-txn-1', 0], ['mock-txn-2', 1]],
    )
  })

  it('--limit is bounded at parse time', async () => {
    const {error, exit} = await run(['transaction', 'list', '--limit', '101'])
    assert.match(error?.message ?? '', /less than or equal to 100/)
    assert.equal(exit, 2)
  })

  it('transaction get shows the envelope, the four artifact roles, and no whole-trace table', async () => {
    const {stdout, error} = await run(['transaction', 'get', 'mock-txn-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Direction\s+inbound/)
    assert.match(stdout, /Partner\s+ACME/)
    assert.match(stdout, /Status\s+delivered/)
    assert.match(stdout, /Acknowledgment\s+n\/a/)
    assert.match(stdout, /Created\s+2026-01-01 12:00:00Z/)
    assert.match(stdout, /tedi artifact get/)
    assert.match(stdout, /Input\s+mock-artifact-1\s+in\.edi\s+from EDI Endpoint/)
    assert.match(stdout, /Output\s+-/)
    assert.doesNotMatch(stdout, /USAGE\s+TYPE/)
  })

  it('transaction get --trace resolves the one transaction on the trace', async () => {
    const {stdout, error} = await run(['transaction', 'get', '--trace', 'aaaaaaaa-0000-0000-0000-000000000001'])
    assert.equal(error, undefined)
    assert.match(stdout, /Transaction set\s+850/)
    const both = await run(['transaction', 'get', 'mock-txn-1', '--trace', 'x'])
    assert.match(both.error?.message ?? '', /not both/)
    const neither = await run(['transaction', 'get'])
    assert.match(neither.error?.message ?? '', /A transaction id or --trace/)
  })

  it('transaction get prints the warnings under the status, with the result that raised each', async () => {
    const {stdout, error} = await run(['transaction', 'get', 'mock-txn-2'])
    assert.equal(error, undefined)
    assert.match(
      stdout,
      /Status\s+delivered\nWarnings\s+mapping_failed\s+\(synthetic\) The mapping produced no document[^\n]*\(result mock-result-2\)\nFlow/,
    )
    // A transaction with no warnings gains no line at all.
    const quiet = await run(['transaction', 'get', 'mock-txn-1'])
    assert.doesNotMatch(quiet.stdout, /Warnings/)
  })

  it('transaction get --json carries the warnings array and the count', async () => {
    const {stdout, error} = await run(['transaction', 'get', 'mock-txn-2', '--json'])
    assert.equal(error, undefined)
    const txn = JSON.parse(stdout)
    assert.equal(txn.status, 'delivered')
    assert.equal(txn.warningCount, 1)
    assert.equal(txn.warnings.length, 1)
    assert.equal(txn.warnings[0].code, 'mapping_failed')
    assert.equal(txn.warnings[0].resultId, 'mock-result-2')
    assert.deepEqual(txn.warnings[0].detail, {mappingName: 'Mock Acme 856'})
  })

  it('transaction get exits 1 for an unknown id and trims whitespace off ids', async () => {
    const {error, exit} = await run(['transaction', 'get', 'nope'])
    assert.match(error?.message ?? '', /No transaction 'nope'/)
    assert.equal(exit, 1)
    const blank = await run(['transaction', 'get', '   '])
    assert.equal(blank.exit, 2)
  })

  it('transaction logs resolves the trace and prints lines oldest first with seconds', async () => {
    const {stdout, error} = await run(['transaction', 'logs', 'mock-txn-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /2026-01-01 12:00:00Z\s+info\s+EDI Endpoint\s+\(synthetic\) Received document[\s\S]*Delivered to webhook/)
  })

  it('transaction logs --trace reads the trace directly, and --since is parsed', async () => {
    const {stdout, error} = await run(['transaction', 'logs', '--trace', 'aaaaaaaa-0000-0000-0000-000000000001', '--since', '2026-01-01'])
    assert.equal(error, undefined)
    assert.match(stdout, /Received document/)
    const bad = await run(['transaction', 'logs', '--trace', 'aaaaaaaa-0000-0000-0000-000000000001', '--since', '2026-01-01T00:00:00'])
    assert.match(bad.error?.message ?? '', /names no time zone/)
  })

  it('transaction resend prints the trace and the follow-up line', async () => {
    const {stdout, error} = await run(['transaction', 'resend', 'mock-txn-2'])
    assert.equal(error, undefined)
    assert.match(stdout, /Resend queued for mock-txn-2/)
    assert.match(stdout, /Follow it with: tedi trace mock-trace-outbound/)
  })

  it('result get shows status, partner, the steps and artifacts', async () => {
    const {stdout, error} = await run(['result', 'get', 'mock-result-1'])
    assert.equal(error, undefined)
    assert.match(stdout, /Status\s+success/)
    assert.match(stdout, /Partner\s+ACME/)
    assert.match(stdout, /EDI Endpoint > EDI to JSON/)
    assert.match(stdout, /mock-artifact-1/)
  })

  it('result list has STATUS and PARTNER columns and no DIR', async () => {
    const {stdout, error} = await run(['result', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /ID\s+NODE\s+STATUS\s+PARTNER\s+TRACE\s+CREATED/)
    assert.doesNotMatch(stdout, /\bDIR\b/)
    const errors = await run(['result', 'list', '--status', 'error'])
    assert.match(errors.stdout, /No results match/)
  })

  it('result get lists the warnings under the status, without repeating the result id', async () => {
    const {stdout, error} = await run(['result', 'get', 'mock-result-2'])
    assert.equal(error, undefined)
    assert.match(stdout, /Status\s+success\nWarnings\s+mapping_failed\s+\(synthetic\) The mapping produced no document[^\n]*\nPartner/)
    // The result being shown is the one that raised it; naming it again is noise.
    assert.doesNotMatch(stdout, /result mock-result-2/)
    const quiet = await run(['result', 'get', 'mock-result-1'])
    assert.doesNotMatch(quiet.stdout, /Warnings/)
  })

  it('result get --json carries detail.warnings through unchanged', async () => {
    const {stdout, error} = await run(['result', 'get', 'mock-result-2', '--json'])
    assert.equal(error, undefined)
    const result = JSON.parse(stdout)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.detail.warnings, [
      {
        code: 'mapping_failed',
        message: '(synthetic) The mapping produced no document; the source was delivered unmapped.',
        detail: {mappingName: 'Mock Acme 856'},
      },
    ])
  })

  it('result list counts warnings beside the status and --json keeps them', async () => {
    const {stdout, error} = await run(['result', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /mock-result-2\s+JSON to EDI\s+success \(1 warning\)\s+ACME/)
    assert.match(stdout, /mock-result-1\s+EDI Endpoint\s+success\s+ACME/)

    const json = await run(['result', 'list', '--json'])
    const rows = JSON.parse(json.stdout).results
    assert.equal(rows.find((r: {id: string}) => r.id === 'mock-result-2').detail.warnings[0].code, 'mapping_failed')
  })

  it('feed list renders entries with a 24-hour footer by default', async () => {
    const {stdout, error} = await run(['feed', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /CREATED\s+DIRECTION\s+STATUS\s+PARTNER\s+TRACE/)
    assert.match(stdout, /2026-01-01 12:00:01Z\s+inbound\s+success\s+ACME/)
    assert.match(stdout, /Showing the last 24 hours/)
    const since = await run(['feed', 'list', '--since', '3d'])
    assert.doesNotMatch(since.stdout, /Showing the last 24 hours/)
    // A trace is a specific thing whenever it happened; no window applies.
    const trace = await run(['feed', 'list', '--trace', 'aaaaaaaa-0000-0000-0000-000000000001'])
    assert.doesNotMatch(trace.stdout, /Showing the last 24 hours/)
  })

  it('feed list --json is the REST envelope', async () => {
    const {stdout} = await run(['feed', 'list', '--json'])
    const page = JSON.parse(stdout)
    assert.equal(page.feedEntries[0].id, 'mock-feed-1')
    assert.equal(page.pagination.nextCursor, 'mock-cursor-1')
  })

  it('feed list --follow excludes --limit', async () => {
    const {error} = await run(['feed', 'list', '--follow', '--limit', '5'])
    assert.match(error?.message ?? '', /cannot also be provided|exclusive/i)
  })

  it('artifact get -o writes the bytes to a file', async () => {
    const target = join(dir, 'out.edi')
    const {error} = await run(['artifact', 'get', 'mock-artifact-1', '-o', target])
    assert.equal(error, undefined)
    const written = await readFile(target, 'utf8')
    assert.match(written, /^ISA\*00\*/)
  })

  it('artifact get -o under a file names the target and the reason, never the temp path', async () => {
    const {error, exit} = await run(['artifact', 'get', 'mock-artifact-1', '-o', join(dir, 'credentials.json', 'out.edi')])
    assert.match(error?.message ?? '', /Cannot write .*credentials\.json\/out\.edi: a component of the path (is not a directory|already exists and is not a directory)/)
    assert.doesNotMatch(error?.message ?? '', /\.tmp/)
    assert.equal(exit, 2)
  })

  it('artifact get --json uses the one no-JSON wording', async () => {
    const {error} = await run(['artifact', 'get', 'mock-artifact-1', '--json'])
    assert.match(error?.message ?? '', /--json is not offered here: the artifact is raw document bytes/)
  })

  it('partner send parses JSON input and prints the receipt with one real follow-up line', async () => {
    const file = join(dir, 'order.json')
    await writeFile(file, JSON.stringify({po: '123'}), 'utf8')
    const {stdout, error} = await run(['partner', 'send', 'ACME', '850', file])
    assert.equal(error, undefined)
    assert.match(stdout, /Processing queued/)
    assert.match(stdout, /Transaction mock-txn-2/)
    assert.match(stdout, /Trace\s+mock-trace-outbound/)
    assert.match(stdout, /^Follow it with: tedi trace mock-trace-outbound$/m)
    assert.doesNotMatch(stdout, /<trace>/)
  })

  it('partner send reads stdin when the file is omitted on a pipe', async () => {
    const {stdout, error} = await withStdin(JSON.stringify({po: '1'}), () => run(['partner', 'send', 'ACME', '850']))
    assert.equal(error, undefined)
    assert.match(stdout, /Processing queued/)
  })

  it('partner send rejects a non-JSON document with a receive hint', async () => {
    const file = join(dir, 'raw.edi')
    await writeFile(file, 'ISA*00*...~', 'utf8')
    const {error} = await run(['partner', 'send', 'ACME', '850', file])
    assert.match(error?.message ?? '', /not valid JSON/)
  })

  it('partner send --wait polls the trace and reports delivery', async () => {
    const file = join(dir, 'order.json')
    await writeFile(file, JSON.stringify({po: '123'}), 'utf8')
    const {stdout, error, exit} = await run(['partner', 'send', 'ACME', '850', file, '--wait'])
    assert.equal(error, undefined)
    assert.equal(exit, 0)
    assert.match(stdout, /Delivered\. Details: tedi trace mock-trace-outbound/)
  })

  it('partner send --wait exits 1 on an errored trace and prints the findings', async () => {
    const file = join(dir, 'order.json')
    await writeFile(file, JSON.stringify({po: '123'}), 'utf8')
    const {stdout, error, exit} = await run(['partner', 'send', 'FAILING', '850', file, '--wait'])
    assert.equal(error, undefined)
    assert.equal(exit, 1)
    assert.match(stdout, /Error at Validation \+ EDI Write:/)
    assert.match(stdout, /Validation failed against implementation 'Mock 850': 2 errors\./)
    assert.match(stdout, /- \/heading\/BEG must have required property/)
    assert.match(stdout, /Details: tedi trace mock-trace-failing/)
  })

  it('partner send --wait exits 2 when the trace is still processing at the deadline', async () => {
    const file = join(dir, 'order.json')
    await writeFile(file, JSON.stringify({po: '123'}), 'utf8')
    process.env.TEDI_WAIT_INTERVAL_MS = '10'
    process.env.TEDI_WAIT_TIMEOUT_MS = '30'
    try {
      const {error, exit} = await run(['partner', 'send', 'HANGING', '850', file, '--wait'])
      assert.equal(exit, 2)
      assert.match(error?.message ?? '', /Trace mock-trace-hanging is still processing after 0\.03s/)
    } finally {
      delete process.env.TEDI_WAIT_INTERVAL_MS
      delete process.env.TEDI_WAIT_TIMEOUT_MS
    }
  })

  it('empty ids exit 2 before any request is made', async () => {
    for (const args of [
      ['partner', 'get', ' '],
      ['result', 'get', ' '],
      ['result', 'payload', ' '],
      ['artifact', 'get', ' '],
      ['transaction', 'resend', ' '],
      ['trace', ' '],
    ]) {
      // The test runner trims a blank argument away, so oclif reports it as
      // missing; a real `tedi partner get " "` reaches requireId. Both exit 2.
      const {error, exit} = await run(args)
      assert.match(error?.message ?? '', /is empty|Missing 1 required arg/, args.join(' '))
      assert.equal(exit, 2, args.join(' '))
    }
  })

  it('partner receive submits raw EDI from a file, from -, and from a bare pipe', async () => {
    const file = join(dir, 'in.edi')
    await writeFile(file, 'ISA*00*...~', 'utf8')
    const {stdout, error} = await run(['partner', 'receive', 'ACME', file])
    assert.equal(error, undefined)
    assert.match(stdout, /Trace aaaaaaaa-0000-0000-0000-000000000001/)
    assert.match(stdout, /^Follow it with: tedi trace aaaaaaaa-0000-0000-0000-000000000001$/m)

    const dash = await withStdin('ISA*00*...~', () => run(['partner', 'receive', 'ACME', '-']))
    assert.equal(dash.error, undefined)
    const bare = await withStdin('ISA*00*...~', () => run(['partner', 'receive', 'ACME']))
    assert.equal(bare.error, undefined)
    assert.match(bare.stdout, /aaaaaaaa-0000-0000-0000-000000000001/)
  })

  it('partner list renders the partner table', async () => {
    const {stdout, error} = await run(['partner', 'list'])
    assert.equal(error, undefined)
    assert.match(stdout, /KEY\s+NAME\s+CONNECTION\s+INBOUND\s+OUTBOUND\s+FLOWS/)
    assert.match(stdout, /ACME\s+Acme Retail\s+Acme SFTP \(sftp\)\s+850\s+856,810\s+inbound active, outbound active/)
  })

  it('partner get shows the connection, envelopes, webhooks, sets with readiness, and flows', async () => {
    const {stdout, error} = await run(['partner', 'get', 'acme'])
    assert.equal(error, undefined)
    assert.match(stdout, /Connection\s+Acme SFTP \(sftp\)/)
    assert.match(stdout, /Host\s+sftp\.example\.invalid:22 as acme/)
    assert.match(stdout, /theirs ZZ RECEIVERID/)
    assert.match(stdout, /inbound https:\/\/example\.invalid\/hooks\/orders \(standard\)/)
    assert.match(stdout, /850\s+inbound\s+mapping: Acme 850\s+yes/)
    assert.match(stdout, /856\s+outbound\s+implementation: Acme 856\s+yes/)
    assert.match(stdout, /810\s+outbound\s+-\s+no \(no mapping or implementation\)/)
    assert.match(stdout, /inbound\s+active\s+Acme Inbound/)
  })

  it('partner get on an unknown key exits 1 and points at partner list', async () => {
    const {error, exit} = await run(['partner', 'get', 'nope'])
    assert.match(error?.message ?? '', /No partner 'nope' in your organization/)
    assert.equal(exit, 1)
  })

  it('trace shows the transactions, results, feed, artifacts and logs', async () => {
    const {stdout, error} = await run(['trace', 'aaaaaaaa-0000-0000-0000-000000000001'])
    assert.equal(error, undefined)
    assert.match(stdout, /Processing\s+no/)
    assert.match(stdout, /mock-txn-1\s+inbound\s+850/)
    assert.match(stdout, /EDI Endpoint\s+success\s+mock-result-1/)
    assert.match(stdout, /inbound\s+success\s+ACME\s+mock-result-1/)
    assert.match(stdout, /mock-artifact-1\s+input\s+EDI Endpoint/)
    assert.match(stdout, /Logs:[\s\S]*Received document/)
    const short = await run(['trace', 'aaaaaaaa-0000-0000-0000-000000000001', '--no-logs'])
    assert.doesNotMatch(short.stdout, /Logs:/)
  })

  it('trace shows each payload and points a failed result at what it received', async () => {
    const {stdout, error} = await run(['trace', 'mock-trace-failing', '--no-logs'])
    assert.equal(error, undefined)
    assert.match(stdout, /PAYLOAD/)
    assert.match(stdout, /mock-result-failed\s+error \d+ B/)
    assert.match(stdout, /What Validation \+ EDI Write received: tedi result payload mock-result-mapped/)
  })

  it('result payload prints EDI raw and JSON pretty-printed', async () => {
    const edi = await run(['result', 'payload', 'mock-result-1'])
    assert.equal(edi.error, undefined)
    assert.match(edi.stdout, /^ISA\*00\*/)

    const json = await run(['result', 'payload', 'mock-result-mapped'])
    assert.equal(json.error, undefined)
    assert.match(json.stdout, /^\{\n {2}"heading"/)
  })

  it('result payload narrows with --json-path and --keys-only, and --json returns the envelope', async () => {
    const path = await run(['result', 'payload', 'mock-result-mapped', '--json-path', 'heading.BEG'])
    assert.deepEqual(JSON.parse(path.stdout), {transaction_set_purpose_code_01: '00'})

    const shape = await run(['result', 'payload', 'mock-result-mapped', '--keys-only'])
    assert.deepEqual(JSON.parse(shape.stdout).detail.PO1, {_type: 'array', _length: 1, _sample: {assigned_identification_01: 'string'}})

    const envelope = JSON.parse((await run(['result', 'payload', 'mock-result-mapped', '--json'])).stdout)
    assert.equal(envelope.format, 'json')
    assert.ok(envelope.contents.heading)
  })

  it('result payload exits 1 on an unknown result or a path that does not resolve', async () => {
    const missing = await run(['result', 'payload', 'nope'])
    assert.equal(missing.exit, 1)
    const miss = await run(['result', 'payload', 'mock-result-mapped', '--json-path', 'heading.NOPE'])
    assert.equal(miss.exit, 1)
    assert.match(miss.error?.message ?? '', /Path 'heading\.NOPE' not found/)
  })

  it('trace --json passes the wire shape through, and an unknown trace exits 1', async () => {
    const {stdout} = await run(['trace', 'aaaaaaaa-0000-0000-0000-000000000001', '--json'])
    const trace = JSON.parse(stdout)
    assert.equal(trace.processing, false)
    assert.equal(trace.ediTransactions[0].id, 'mock-txn-1')
    const {exit} = await run(['trace', 'nope'])
    assert.equal(exit, 1)
  })

  it('whoami reports the full identity', async () => {
    const {stdout, error} = await run(['whoami'])
    assert.equal(error, undefined)
    assert.match(stdout, /Acme EDI \(dev\) \(scope: standard, key 'Development key' \.\.\.1234\)/)
  })

  // The rest of the read-only control plane: one list and one get per noun,
  // each exercising its table or view and the --json pass-through.

  it('connection list and get render the transport and its partners, never a credential', async () => {
    const list = await run(['connection', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /ID\s+NAME\s+KIND\s+HOST\s+PROVISIONED\s+PARTNERS/)
    assert.match(list.stdout, /mock-connection-1\s+Acme SFTP\s+sftp\s+sftp\.example\.invalid\s+yes\s+1/)

    const get = await run(['connection', 'get', 'mock-connection-1'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Host\s+sftp\.example\.invalid:22 as acme/)
    assert.match(get.stdout, /Partners:\n\s+ACME\s+Acme Retail/)
    assert.doesNotMatch(get.stdout, /password/i)

    const json = await run(['connection', 'get', 'mock-connection-1', '--json'])
    assert.equal(JSON.parse(json.stdout).partners[0].key, 'ACME')
    const missing = await run(['connection', 'get', 'nope'])
    assert.equal(missing.exit, 1)
    assert.match(missing.error?.message ?? '', /No connection 'nope'/)
  })

  it('envelope list and get show the identifiers and the role per partner', async () => {
    const list = await run(['envelope', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-envelope-1\s+Us\s+ours\s+SENDERID\s+ZZ\s+SENDERID/)
    assert.match(list.stdout, /mock-envelope-2\s+Acme\s+partner\s+RECEIVERID/)

    const get = await run(['envelope', 'get', 'mock-envelope-2'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /ISA\s+ZZ RECEIVERID/)
    assert.match(get.stdout, /Separators\s+segment ~\s+element \*\s+component >/)
    assert.match(get.stdout, /ACME\s+external\s+Acme Retail/)
  })

  it('webhook list and get show the URL and the role per partner, never a secret', async () => {
    const list = await run(['webhook', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-webhook-1\s+Orders\s+standard\s+https:\/\/example\.invalid\/hooks\/orders/)

    const get = await run(['webhook', 'get', 'mock-webhook-1'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Content type\s+application\/json/)
    assert.match(get.stdout, /ACME\s+inbound\s+Acme Retail/)
    assert.doesNotMatch(get.stdout, /secret/i)
  })

  it('flow list filters, and flow get shows nodes and edges by name', async () => {
    const list = await run(['flow', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-flow-1\s+Acme Inbound\s+ACME\s+inbound\s+active\s+5m\s+1\s+no/)
    assert.match(list.stdout, /mock-flow-2\s+Acme Outbound\s+ACME\s+outbound\s+active\s+paused\s+2\s+no/)

    const filtered = await run(['flow', 'list', '--direction', 'inbound', '--partner', 'acme'])
    assert.match(filtered.stdout, /Acme Inbound/)
    assert.doesNotMatch(filtered.stdout, /Acme Outbound/)
    const none = await run(['flow', 'list', '--partner', 'NOPE'])
    assert.match(none.stdout, /No flows match/)

    const get = await run(['flow', 'get', 'mock-flow-2'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Frequency\s+paused/)
    assert.match(get.stdout, /mock-node-2\s+Acme 856 mapping\s+transformation\s+mapping/)
    assert.match(get.stdout, /Partner endpoint -> Acme 856 mapping/)
    assert.match(get.stdout, /Acme 856 mapping -> Upload/)
  })

  it('mapping list, get, versions, and -o writing the transformation alone', async () => {
    const list = await run(['mapping', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-mapping-2\s+Acme 856\s+outbound\s+Acme 856\s+Shipment\s+2\s+1\s+ACME/)
    const outbound = await run(['mapping', 'list', '--direction', 'inbound'])
    assert.doesNotMatch(outbound.stdout, /mock-mapping-2/)

    const get = await run(['mapping', 'get', 'mock-mapping-2'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Implementation Acme 856 \(mock-impl-1\)/)
    assert.match(get.stdout, /Source\s+Shipment \(mock-source-1\)/)
    assert.match(get.stdout, /Version\s+2, Added carrier placeholder/)
    assert.match(get.stdout, /line 1, column 28: "SCAC" \(not in source\)/)
    assert.match(get.stdout, /```\n\{ "heading": \{ "carrier": \$placeholder/)

    const older = await run(['mapping', 'get', 'mock-mapping-2', '--version', '1'])
    assert.equal(older.error, undefined)
    assert.match(older.stdout, /Implementation Acme 856/)
    assert.match(older.stdout, /Version\s+1\n/)
    assert.match(older.stdout, /\{ "heading": \{\} \}/)
    const olderJson = await run(['mapping', 'get', 'mock-mapping-2', '--version', '1', '--json'])
    assert.equal(JSON.parse(olderJson.stdout).versionNumber, 1)
    const noVersion = await run(['mapping', 'get', 'mock-mapping-2', '--version', '9'])
    assert.equal(noVersion.exit, 1)
    assert.match(noVersion.error?.message ?? '', /No version 9 of mapping mock-mapping-2/)
    const stdoutJson = await run(['mapping', 'get', 'mock-mapping-2', '-o', '-', '--json'])
    assert.equal(JSON.parse(stdoutJson.stdout).id, 'mock-mapping-2')

    const file = join(dir, 'map.jsonata')
    const written = await run(['mapping', 'get', 'mock-mapping-2', '-o', file])
    assert.equal(written.error, undefined)
    assert.equal(await readFile(file, 'utf8'), '{ "heading": { "carrier": $placeholder("SCAC", "not in source") } }')

    const versions = await run(['mapping', 'versions', 'mock-mapping-2'])
    assert.equal(versions.error, undefined)
    assert.match(versions.stdout, /VERSION\s+SAVED\s+BY\s+NOTE/)
    assert.match(versions.stdout, /2\s+2026-01-02 00:00:00Z\s+Dev\s+Added carrier placeholder/)
  })

  it('implementation list, get, schema, guide and export', async () => {
    const list = await run(['implementation', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-impl-1\s+Acme 856\s+856\s+004010\s+1\s+active\s+12\s+3\s+-/)
    assert.match(list.stdout, /mock-impl-2\s+Acme 850\s+850\s+004010\s+1\s+draft\s+20\s+4\s+Public 850/)
    const one = await run(['implementation', 'list', '--set', '850'])
    assert.doesNotMatch(one.stdout, /mock-impl-1/)

    const get = await run(['implementation', 'get', 'mock-impl-1'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Acme 856  \(856 in 004010\)/)
    assert.match(get.stdout, /Structure\s+12 segments, 3 loops/)
    assert.match(get.stdout, /Partners using it directly:\n\s+ACME\s+Acme Retail/)

    const schema = await run(['implementation', 'schema', 'mock-impl-1'])
    assert.equal(schema.error, undefined)
    assert.equal(JSON.parse(schema.stdout).$schema, 'https://json-schema.org/draft/2020-12/schema')
    const schemaFile = join(dir, 'schema.json')
    await run(['implementation', 'schema', 'mock-impl-1', '-o', schemaFile])
    assert.equal(JSON.parse(await readFile(schemaFile, 'utf8')).type, 'object')

    const guide = await run(['implementation', 'guide', 'mock-impl-1'])
    assert.equal(guide.error, undefined)
    assert.match(guide.stdout, /R  ZZA - Synthetic Opening Segment/)
    const markdown = await run(['implementation', 'guide', 'mock-impl-1', '--format', 'markdown'])
    assert.match(markdown.stdout, /^# Acme 856 \(v1\)/)
    const guideJson = await run(['implementation', 'guide', 'mock-impl-1', '--json'])
    assert.equal(guideJson.exit, 2)
    assert.match(guideJson.error?.message ?? '', /rendered document/)

    const exportFile = join(dir, 'export.json')
    const exported = await run(['implementation', 'export', 'mock-impl-1', '-o', exportFile])
    assert.equal(exported.error, undefined)
    const doc = JSON.parse(await readFile(exportFile, 'utf8'))
    assert.equal(doc.format_version, 1)
    assert.equal(doc.implementation.transaction_set_code, '856')
  })

  it('source list and get show the sample and the mappings reading it', async () => {
    const list = await run(['source', 'list'])
    assert.equal(list.error, undefined)
    assert.match(list.stdout, /mock-source-1\s+Shipment\s+Acme 856/)

    const get = await run(['source', 'get', 'mock-source-1'])
    assert.equal(get.error, undefined)
    assert.match(get.stdout, /Semantics\s+One shipment with its lines\./)
    assert.match(get.stdout, /"number": "SH-1"/)
    const json = await run(['source', 'get', 'mock-source-1', '--json'])
    assert.equal(JSON.parse(json.stdout).sample.shipment.number, 'SH-1')
  })
})
