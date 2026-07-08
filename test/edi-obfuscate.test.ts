import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, it} from 'node:test'

import {runCommand} from '@oclif/test'

import {NotAnInterchangeError, obfuscateInterchange} from '../src/lib/edi-obfuscate.js'

// Keep the update-check plugin from doing background network work during tests.
process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
// Ensure an ambient TEDI_API_KEY in the dev's shell can't perturb the
// runs-without-auth assertions below.
delete process.env.TEDI_API_KEY

const root = process.cwd()
const run = (args: string[]) => runCommand(args, {root}, {stripAnsi: true})

// Entirely synthetic 837-flavored interchange (no real data, tedi:synthetic-data-ok).
// Exercises: person vs org NM1, addresses, DOB, contact info, sensitive and
// business REF qualifiers, patient account number, free text, and the
// pattern-fallback layer (email / dashed SSN in an unlisted REF qualifier).
const SEGMENTS = [
  'ISA*00*          *00*          *ZZ*SENDERID12345  *ZZ*RECEIVERID1234 *240101*1200*>*00501*000000001*0*T*:',
  'GS*HC*SENDERID*RECEIVERID*20240101*1200*1*X*005010X222A1',
  'ST*837*0001*005010X222A1',
  'BHT*0019*00*0001*20240101*1200*CH',
  'NM1*85*2*ACME CLINIC*****XX*1234567890',
  'N3*100 MAIN ST',
  'N4*SPRINGFIELD*IL*627011234',
  'REF*EI*987654321',
  'NM1*IL*1*DOE*JANE*Q***MI*MBR123456789',
  'N3*42 ELM STREET*APT 9',
  'N4*SPRINGFIELD*IL*62701',
  'DMG*D8*19801231*F',
  'DMG*RD8*19800101-19851231*F',
  'PER*IC*JANE DOE*TE*2175551234*EM*jane.doe@example.com',
  'REF*SY*111223333',
  'REF*1W*MBR123456789',
  'REF*ZZ*bob@example.com',
  'REF*ZZ*123-45-6789',
  'REF*ZZ*jane.doe@example.com',
  'CLM*ACCT0001*100***11:B:1*Y*A*Y*Y',
  'HI*ABK:J20',
  'NTE*ADD*PATIENT CALLED FROM 2175551234',
  'SE*21*0001',
  'GE*1*1',
  'IEA*1*000000001',
]
const INTERCHANGE = SEGMENTS.join('~\n') + '~\n'

/** Element lookup on obfuscated output: first segment with this id, split on '*'. */
function segment(output: string, id: string, skip = 0): string[] {
  const found = output
    .split('~')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(id + '*'))
  assert.ok(found.length > skip, `expected segment ${id} #${skip} in output`)
  return found[skip].split('*')
}

describe('obfuscateInterchange', () => {
  const result = obfuscateInterchange(INTERCHANGE, {seed: 'test-seed'})
  const out = result.output

  it('preserves segment count, order, and formatting byte layout', () => {
    const inIds = INTERCHANGE.split('~').map((c) => c.trim().split('*')[0])
    const outIds = out.split('~').map((c) => c.trim().split('*')[0])
    assert.deepEqual(outIds, inIds)
    assert.equal(out.length, INTERCHANGE.length)
    assert.ok(out.endsWith('~\n'))
    assert.equal(result.segmentCount, SEGMENTS.length)
  })

  it('leaves the ISA envelope byte-identical (fixed width, routing IDs kept)', () => {
    assert.equal(out.split('~')[0], INTERCHANGE.split('~')[0])
  })

  it('obfuscates person names but keeps org names and NPIs', () => {
    const subscriber = segment(out, 'NM1', 1)
    assert.notEqual(subscriber[3], 'DOE')
    assert.notEqual(subscriber[4], 'JANE')
    assert.equal(subscriber[3].length, 3)
    const billing = segment(out, 'NM1', 0)
    assert.equal(billing[3], 'ACME CLINIC')
    assert.equal(billing[9], '1234567890')
  })

  it('obfuscates member IDs consistently across segments (referential integrity)', () => {
    const nm109 = segment(out, 'NM1', 1)[9]
    const ref1w = segment(out, 'REF', 2)[2]
    assert.notEqual(nm109, 'MBR123456789')
    assert.equal(nm109.length, 'MBR123456789'.length)
    assert.equal(nm109, ref1w)
  })

  it('obfuscates addresses, keeps state, keeps first 3 ZIP digits', () => {
    assert.ok(!out.includes('42 ELM STREET'))
    assert.ok(!out.includes('100 MAIN ST'))
    const n4 = segment(out, 'N4', 1)
    assert.notEqual(n4[1], 'SPRINGFIELD')
    assert.equal(n4[2], 'IL')
    assert.match(n4[3], /^627\d{2}$/)
    assert.notEqual(n4[3], '62701')
  })

  it('keeps the DOB year, replaces month/day with a valid date', () => {
    const dob = segment(out, 'DMG')[2]
    assert.match(dob, /^1980(0[1-9]|1[0-2])(0[1-9]|1\d|2[0-8])$/)
    assert.notEqual(dob, '19801231')
  })

  it('keeps both years of an RD8 date range', () => {
    const range = segment(out, 'DMG', 1)[2]
    assert.match(range, /^1980\d{4}-1985\d{4}$/)
    assert.notEqual(range, '19800101-19851231')
  })

  it('obfuscates contact name, phone, and email (format preserved)', () => {
    const per = segment(out, 'PER')
    assert.notEqual(per[2], 'JANE DOE')
    assert.match(per[4], /^\d{10}$/)
    assert.notEqual(per[4], '2175551234')
    assert.match(per[6], /^[a-z]{4}\.[a-z]{3}@[a-z]{7}\.[a-z]{3}$/)
  })

  it('obfuscates sensitive REF qualifiers, keeps business ones', () => {
    assert.equal(segment(out, 'REF', 0)[2], '987654321') // EI = tax ID, kept
    assert.notEqual(segment(out, 'REF', 1)[2], '111223333') // SY = SSN
  })

  it('catches emails and dashed SSNs in elements no positional rule covers', () => {
    const email = segment(out, 'REF', 3)[2]
    assert.notEqual(email, 'bob@example.com')
    assert.ok(email.includes('@'))
    const ssn = segment(out, 'REF', 4)[2]
    assert.match(ssn, /^\d{3}-\d{2}-\d{4}$/)
    assert.notEqual(ssn, '123-45-6789')
  })

  it('maps a value identically whether a positional rule or the fallback caught it', () => {
    // jane.doe@example.com appears in PER06 (PER rule) and REF*ZZ (fallback only).
    assert.equal(segment(out, 'PER')[6], segment(out, 'REF', 5)[2])
  })

  it('obfuscates patient account numbers and free text, keeps amounts and codes', () => {
    const clm = segment(out, 'CLM')
    assert.notEqual(clm[1], 'ACCT0001')
    assert.equal(clm[2], '100')
    assert.equal(clm[5], '11:B:1')
    assert.ok(out.includes('HI*ABK:J20'))
    assert.ok(!out.includes('PATIENT CALLED'))
  })

  it('leaves trailers and control numbers untouched', () => {
    assert.ok(out.includes('SE*21*0001'))
    assert.ok(out.includes('IEA*1*000000001'))
  })

  it('is reproducible with the same seed and different without one', () => {
    const again = obfuscateInterchange(INTERCHANGE, {seed: 'test-seed'}).output
    assert.equal(again, out)
    const otherSeed = obfuscateInterchange(INTERCHANGE, {seed: 'other'}).output
    assert.notEqual(otherSeed, out)
    const random1 = obfuscateInterchange(INTERCHANGE).output
    const random2 = obfuscateInterchange(INTERCHANGE).output
    assert.notEqual(random1, random2)
  })

  it('handles a single-line 004010-style interchange (ISA11 is not a separator)', () => {
    const oneLine = INTERCHANGE.replaceAll('~\n', '~').replace('*>*00501*', '*U*00401*')
    const res = obfuscateInterchange(oneLine, {seed: 's'})
    assert.equal(res.segmentCount, SEGMENTS.length)
    assert.ok(!res.output.includes('\n'))
    assert.ok(!res.output.includes('MBR123456789'))
    assert.ok(res.output.includes('*U*00401*'))
  })

  it('rejects input that is not an X12 interchange', () => {
    assert.throws(() => obfuscateInterchange('hello world'), NotAnInterchangeError)
    assert.throws(() => obfuscateInterchange('ISA*00'), NotAnInterchangeError)
  })

  it('handles multiple interchanges when their delimiters match', () => {
    const res = obfuscateInterchange(INTERCHANGE + INTERCHANGE, {seed: 's'})
    assert.equal(res.segmentCount, SEGMENTS.length * 2)
    assert.ok(!res.output.includes('MBR123456789'))
  })

  it('refuses a later interchange that declares different delimiters', () => {
    const mixed = INTERCHANGE + 'ISA|00|          |00|          |ZZ|SENDER~'
    assert.throws(() => obfuscateInterchange(mixed, {seed: 's'}), /delimiters differ from the first/)
  })
})

describe('edi obfuscate command', () => {
  let dir: string

  beforeEach(async () => {
    // No credentials on purpose: obfuscation is local and must not require auth.
    dir = await mkdtemp(join(tmpdir(), 'tedi-obf-'))
    process.env.TEDI_CONFIG_DIR = dir
  })

  afterEach(async () => {
    delete process.env.TEDI_CONFIG_DIR
    await rm(dir, {recursive: true, force: true})
  })

  it('writes obfuscated EDI to stdout and a summary to stderr, without auth', async () => {
    const file = join(dir, 'in.edi')
    await writeFile(file, INTERCHANGE, 'utf8')
    const {stdout, stderr, error} = await run(['edi', 'obfuscate', file, '--seed', 's'])
    assert.equal(error, undefined)
    assert.ok(stdout.startsWith('ISA*00*'))
    assert.ok(!stdout.includes('MBR123456789'))
    assert.match(stderr, /Obfuscated \d+ values across \d+ segments\./)
  })

  it('--output writes the file and reports on stdout', async () => {
    const file = join(dir, 'in.edi')
    const outFile = join(dir, 'out.edi')
    await writeFile(file, INTERCHANGE, 'utf8')
    const {stdout, error} = await run(['edi', 'obfuscate', file, '--seed', 's', '-o', outFile])
    assert.equal(error, undefined)
    assert.match(stdout, /Wrote .*out\.edi/)
    const written = await readFile(outFile, 'utf8')
    assert.ok(written.startsWith('ISA*00*'))
    assert.ok(!written.includes('MBR123456789'))
  })

  it('fails clearly when the file does not exist', async () => {
    const {error} = await run(['edi', 'obfuscate', join(dir, 'nope.edi')])
    assert.match(error?.message ?? '', /File not found/)
  })

  it('fails clearly on a non-EDI file', async () => {
    const file = join(dir, 'notes.txt')
    await writeFile(file, 'just some text', 'utf8')
    const {error} = await run(['edi', 'obfuscate', file])
    assert.match(error?.message ?? '', /doesn't look like an X12 interchange/)
  })
})
