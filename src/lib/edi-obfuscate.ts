/**
 * Local X12 PII obfuscation. Runs entirely client-side — the file never leaves
 * the machine — so it can be scrubbed before sharing it or before opting into
 * server-backed features.
 *
 * Strategy (see the command help for the user-facing summary):
 *
 * - Position-based rules, not blind pattern matching. X12 is fully positional,
 *   so PII is located by (segment id, element position, qualifier value). A
 *   blanket "scrub long numbers" pass would destroy control numbers, monetary
 *   amounts, and code values that validators (and the bug being debugged)
 *   depend on. A narrow pattern fallback (SSN-with-dashes, email) catches PII
 *   that leaks into unexpected elements; it only scans elements the positional
 *   rules left untouched, so no value is ever substituted twice.
 *
 * - Format-preserving, consistent substitution. Each alphanumeric character is
 *   replaced within its class (digit→digit, letter→letter, case kept); all
 *   other characters (spaces, punctuation, delimiters) pass through. The
 *   replacement is derived from an HMAC of the whole value, so:
 *     - the same value maps to the same replacement everywhere in the run,
 *       preserving referential integrity across segments;
 *     - element lengths never change, so the fixed-width ISA header, SE01
 *       segment counts, and element min/max constraints all stay valid;
 *     - the mapping is not reversible without the run key, which is random per
 *       run (or derived from --seed for reproducible output).
 *
 * - Structure is sacred: delimiters, qualifiers, code values, dates of
 *   service, monetary amounts, and control numbers are left byte-identical.
 *   Replacement characters are drawn from alphabets that exclude the
 *   interchange's delimiter characters, so a substitution can never introduce
 *   a structural character into data. A file may carry several ISA..IEA
 *   interchanges; each is checked against the first one's delimiters, and the
 *   run fails loudly rather than mis-parse (and silently leak) an interchange
 *   that declares different separators.
 */

import {createHash, createHmac, randomBytes} from 'node:crypto'

import {TediError} from './errors.js'

/** Raised when the input does not look like an X12 interchange. */
export class NotAnInterchangeError extends TediError {
  constructor(reason: string) {
    super(`This doesn't look like an X12 interchange: ${reason}`, {
      suggestions: ['An X12 file starts with a fixed-width ISA segment, e.g. `ISA*00*...`.'],
      exitCode: 1,
    })
    this.name = 'NotAnInterchangeError'
  }
}

export interface ObfuscateOptions {
  /** Seed for reproducible output. Omitted → a fresh random key per run. */
  seed?: string
}

export interface ObfuscateResult {
  output: string
  /** Number of element values that were replaced. */
  valuesObfuscated: number
  /** Total segments in the interchange. */
  segmentCount: number
}

/** NM108 qualifiers whose NM109 identifies a person (member ID, SSN, insured's ID). */
const PERSONAL_ID_QUALIFIERS = new Set(['MI', 'II', '34', 'SY'])

/**
 * REF01 qualifiers whose REF02 is a personal identifier: SY=SSN, 0F=subscriber
 * number, 1L/6P=group or policy number, 1W=member ID, 23=client number,
 * EA=medical record number, EJ=patient account number, F6=Medicare HIC number,
 * HJ=identity card number, IG=insurance policy number.
 */
const SENSITIVE_REF_QUALIFIERS = new Set(['SY', '0F', '1L', '1W', '23', '6P', 'EA', 'EJ', 'F6', 'HJ', 'IG'])

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'

/**
 * Format-preserving value substitutor. Replacements are a pure function of
 * (key, value), which is what makes the mapping consistent across the run —
 * and what makes the memo cache sound.
 */
class Substitutor {
  private readonly key: Buffer
  private readonly upper: string
  private readonly lower: string
  private readonly digits: string
  // Value → replacement. Repeated identifiers (member IDs across thousands of
  // claims in a batch file) cost one HMAC pass total instead of one per use.
  private readonly memo = new Map<string, string>()

  constructor(seed: string | undefined, delimiters: Iterable<string>) {
    this.key = seed === undefined ? randomBytes(32) : createHash('sha256').update(seed, 'utf8').digest()
    // Never emit a delimiter character from a substitution. Delimiters are
    // almost never alphanumeric, so these alphabets are usually untouched.
    const forbidden = new Set(delimiters)
    this.upper = [...UPPER].filter((c) => !forbidden.has(c)).join('')
    this.lower = [...LOWER].filter((c) => !forbidden.has(c)).join('')
    this.digits = [...DIGITS].filter((c) => !forbidden.has(c)).join('')
  }

  /** Deterministic 32-byte block for a value: HMAC(key, value || block index). */
  private digestBlock(value: string, block: number): Buffer {
    return createHmac('sha256', this.key).update(value, 'utf8').update(` ${block}`, 'utf8').digest()
  }

  /** Replace alphanumerics in-class; leave everything else byte-identical. */
  substitute(value: string): string {
    const hit = this.memo.get(value)
    if (hit !== undefined) return hit

    let out = ''
    let i = 0
    let block = -1
    let digest: Buffer = Buffer.alloc(0)
    for (const ch of value) {
      let alphabet = ''
      if (ch >= 'A' && ch <= 'Z') alphabet = this.upper
      else if (ch >= 'a' && ch <= 'z') alphabet = this.lower
      else if (ch >= '0' && ch <= '9') alphabet = this.digits
      if (alphabet.length > 0) {
        // One digest serves 32 characters; compute each block once per value.
        const wanted = Math.floor(i / 32)
        if (wanted !== block) {
          block = wanted
          digest = this.digestBlock(value, wanted)
        }
        out += alphabet.charAt((digest[i % 32] ?? 0) % alphabet.length)
      } else {
        out += ch
      }
      i++
    }

    this.memo.set(value, out)
    return out
  }

  /**
   * Obfuscate a date element keeping the year (Safe Harbor keeps the year):
   * CCYYMMDD and CCYYMMDD-CCYYMMDD (RD8 range) forms get a synthetic valid
   * month/day; anything else falls back to full substitution.
   */
  date(value: string): string {
    if (/^\d{8}$/.test(value)) return this.date8(value)
    if (/^\d{8}-\d{8}$/.test(value)) {
      return value
        .split('-')
        .map((part) => this.date8(part))
        .join('-')
    }
    return this.substitute(value)
  }

  /** CCYYMMDD (pre-validated) → same year, synthetic valid month/day. */
  private date8(value: string): string {
    const digest = this.digestBlock(value, 0)
    const month = 1 + ((digest[0] ?? 0) % 12)
    const day = 1 + ((digest[1] ?? 0) % 28)
    return value.slice(0, 4) + String(month).padStart(2, '0') + String(day).padStart(2, '0')
  }

  /** ZIP: keep the first 3 digits (Safe Harbor geographic granularity), scrub the rest. */
  zip(value: string): string {
    if (value.length <= 3) return value
    return value.slice(0, 3) + this.substitute(value).slice(3)
  }
}

interface Delimiters {
  element: string
  component: string
  repetition?: string
  segment: string
}

/**
 * Read the delimiters out of the fixed-width ISA header. The element separator
 * is the 4th character; ISA16 (component separator) is the character after the
 * 16th separator; the segment terminator follows it. ISA11 is the repetition
 * separator from 00402 on — recognizable because it is non-alphanumeric (in
 * 00401 the same position holds the standards ID "U").
 */
function readDelimiters(input: string, isaStart: number): Delimiters {
  const element = input.charAt(isaStart + 3)
  // A valid ISA is 106 characters; a 120-char window covers it with slack, and
  // splitting the window on the element separator yields ISA01..ISA16 directly.
  const parts = input.slice(isaStart, isaStart + 120).split(element)
  const isa16 = parts[16]
  if (element === '' || parts.length < 17 || isa16 === undefined || isa16.length < 2) {
    throw new NotAnInterchangeError('the ISA segment is truncated.')
  }

  const isa11 = parts[11] ?? ''
  const repetition = isa11.length === 1 && !/[A-Za-z0-9 ]/.test(isa11) ? isa11 : undefined

  return {element, component: isa16.charAt(0), repetition, segment: isa16.charAt(1)}
}

type ElementRule = (e: string[], sub: Substitutor) => void

/** Rule that substitutes the elements at the given positions, when present. */
const scrub =
  (...indices: number[]): ElementRule =>
  (e, sub) => {
    for (const i of indices) {
      const value = e[i]
      if (value) e[i] = sub.substitute(value)
    }
  }

/** Rule that obfuscates a date element (year kept for D8/RD8 forms). */
const scrubDate =
  (index: number): ElementRule =>
  (e, sub) => {
    const value = e[index]
    if (value) e[index] = sub.date(value)
  }

const PERSON_NAME_ELEMENTS = scrub(3, 4, 5, 6, 7)
const PERSON_ID_ELEMENT = scrub(9)
const SENSITIVE_REF_ELEMENTS = scrub(2, 3)

/**
 * The positional PII map. Scope is personal PII: names of persons, street
 * addresses, city/ZIP, DOB, contact info, member/SSN-class identifiers,
 * patient account numbers, bank account/routing data, and free text.
 * Business identifiers (ISA06/08 routing IDs, org names, NPIs, tax IDs) and
 * everything structural (qualifiers, codes, dates of service, amounts,
 * control numbers) are deliberately preserved.
 */
const SEGMENT_RULES: Record<string, ElementRule> = {
  // ISA02/ISA04: authorization/security information — occasionally holds real
  // credentials. All-blank values pass through unchanged (spaces are kept), so
  // the fixed 10-char widths survive either way.
  ISA: scrub(2, 4),
  // Person names (NM102=1) and person-class identifiers. Org names (NM102=2)
  // and business identifiers (XX=NPI, FI, PI, 46...) are kept.
  NM1(e, sub) {
    if (e[2] === '1') PERSON_NAME_ELEMENTS(e, sub)
    const qualifier = e[8]
    if (qualifier && PERSONAL_ID_QUALIFIERS.has(qualifier)) PERSON_ID_ELEMENT(e, sub)
  },
  N3: scrub(1, 2),
  // City and ZIP; state and country codes stay (state-level geography is not PII).
  N4(e, sub) {
    const city = e[1]
    if (city) e[1] = sub.substitute(city)
    const zip = e[3]
    if (zip) e[3] = sub.zip(zip)
  },
  // Date of birth: keep the year, scrub month/day.
  DMG: scrubDate(2),
  // Contact name and communication numbers (phone/fax/email/URL).
  PER: scrub(2, 4, 6, 8),
  REF(e, sub) {
    const qualifier = e[1]
    if (qualifier && SENSITIVE_REF_QUALIFIERS.has(qualifier)) SENSITIVE_REF_ELEMENTS(e, sub)
  },
  // Patient account numbers (Safe Harbor account-number class).
  CLM: scrub(1),
  CLP: scrub(1),
  // PAT06: date of death.
  PAT: scrubDate(6),
  // Bank routing (07/13) and account (09/15) numbers in payment order/remittance.
  BPR: scrub(7, 9, 13, 15),
  // CR109/CR110: ambulance round-trip/stretcher purpose — free-text narratives.
  CR1: scrub(9, 10),
  // Free text can contain anything (names, phones, narratives): scrub wholesale.
  NTE: scrub(2),
  MSG: scrub(1),
  K3: scrub(1),
}

function leadingWhitespace(s: string): string {
  return /^\s*/.exec(s)?.[0] ?? ''
}

/** Obfuscate personal PII in a full X12 interchange, preserving structure exactly. */
export function obfuscateInterchange(input: string, opts: ObfuscateOptions = {}): ObfuscateResult {
  const body = input.replace(/^\uFEFF/, '')
  const isaStart = leadingWhitespace(body).length
  if (!body.startsWith('ISA', isaStart)) {
    throw new NotAnInterchangeError('it does not start with an ISA segment.')
  }

  const delims = readDelimiters(body, isaStart)
  const sub = new Substitutor(
    opts.seed,
    [delims.element, delims.component, delims.segment, delims.repetition ?? ''].filter(Boolean),
  )

  let valuesObfuscated = 0
  let segmentCount = 0

  const scrubPiece = (piece: string) =>
    SSN_PATTERN.test(piece) || EMAIL_PATTERN.test(piece) ? sub.substitute(piece) : piece

  const transformSegment = (content: string): string => {
    const elements = content.split(delims.element)
    segmentCount++

    // One file can carry several ISA..IEA interchanges, and each ISA declares
    // its own delimiters. Mis-parsing a later interchange would silently leak
    // its PII, so require every ISA to match the first one's delimiters.
    const id = elements[0] ?? ''
    if (id.startsWith('ISA') && (id !== 'ISA' || elements.length !== 17 || elements[16] !== delims.component)) {
      throw new TediError(
        'This file contains an interchange whose delimiters differ from the first; it cannot be obfuscated safely in one pass.',
        {suggestions: ['Split the file so each ISA..IEA interchange is its own file, then obfuscate each one.']},
      )
    }

    const before = elements.slice()
    SEGMENT_RULES[id]?.(elements, sub)

    // Fallback pattern layer: SSNs and emails that leak into elements the
    // positional rules don't cover. Checked per component/repeat so composite
    // elements are handled; everything else is left alone (a blanket numeric
    // scrub would corrupt counts, amounts, and codes). Elements a positional
    // rule already replaced are skipped — re-substituting them would give the
    // same original value different replacements in different segments.
    for (let i = 1; i < elements.length; i++) {
      const value = elements[i] ?? ''
      if (value !== before[i]) continue
      // Cheap gate: an email needs '@', a dashed SSN needs '-'.
      if (!value.includes('@') && !value.includes('-')) continue
      const repeats = delims.repetition ? value.split(delims.repetition) : [value]
      elements[i] = repeats
        .map((repeat) => repeat.split(delims.component).map(scrubPiece).join(delims.component))
        .join(delims.repetition ?? '')
    }

    for (let i = 0; i < elements.length; i++) {
      if (elements[i] !== before[i]) valuesObfuscated++
    }

    return elements.join(delims.element)
  }

  // Split on the segment terminator, transforming each chunk's content while
  // preserving inter-segment whitespace (newlines after terminators) exactly.
  // Content runs all the way to the terminator: trailing spaces belong to the
  // segment's final element and pass through substitution unchanged, keeping
  // the same-bytes-same-replacement guarantee exact.
  const chunks = body.split(delims.segment)
  const out = chunks.map((chunk) => {
    const leading = leadingWhitespace(chunk)
    const content = chunk.slice(leading.length)
    // The final chunk is whatever follows the last terminator — usually empty
    // or a newline; it is transformed too if it holds an unterminated segment.
    if (content === '') return chunk
    return leading + transformSegment(content)
  })

  return {output: out.join(delims.segment), valuesObfuscated, segmentCount}
}
