/**
 * Thin client over the Tediware API.
 *
 * Per the brief, the CLI carries no proprietary logic and no licensed data: X12
 * reference rendering (including color and truncation) happens server-side, and
 * the client simply relays the requested format and returns what the server
 * renders. This module defines the client interface plus two implementations:
 *
 *   - `MockApiClient`   — canned, clearly-synthetic responses so the CLI is fully
 *                         runnable before the server endpoints exist. The mock data
 *                         here is invented for development and is NOT licensed X12
 *                         reference content.
 *   - `HttpApiClient`   — real HTTP skeleton. Reference/identity calls hit the
 *                         platform; auth device-flow endpoints throw until they ship.
 *
 * `createApiClient` selects between them. The mock is the default so a fresh
 * checkout works out of the box; set `TEDI_API_MOCK=0` to force the HTTP client.
 */

import {OutputFormat} from './output.js'
import {NotAuthenticatedError, TediError, TermsNotAcceptedError} from './errors.js'
import {fetchWithTimeout} from './http.js'

export interface ReferenceRequest {
  release: string
  format: OutputFormat
  /** Whether to request server-side ANSI color (console format only). */
  color: boolean
}

/** A server-rendered reference document. `body` is ready to print as-is. */
export interface RenderedReference {
  release: string
  format: OutputFormat
  body: string
}

export interface ReleaseInfo {
  id: string
  description: string
}

export interface Identity {
  organization: string
  keyScope: string
  /** Last 4 characters of the API key, for display. */
  keyHint: string
}

export interface DeviceAuthStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** Suggested polling interval in seconds. */
  interval: number
  /** Seconds until the device code expires. */
  expiresIn: number
}

export type DeviceAuthPoll =
  | {status: 'pending'}
  | {status: 'slow_down'}
  | {status: 'complete'; token: string}
  | {status: 'expired'}
  | {status: 'denied'}

export interface ApiClient {
  readonly isMock: boolean
  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference>
  x12Releases(): Promise<ReleaseInfo[]>
  whoami(): Promise<Identity>
  startDeviceAuth(): Promise<DeviceAuthStart>
  pollDeviceAuth(deviceCode: string): Promise<DeviceAuthPoll>
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

const MOCK_RELEASES: ReleaseInfo[] = [
  {id: '004010', description: 'ASC X12 version 004010'},
  {id: '005010', description: 'ASC X12 version 005010'},
  {id: '006020', description: 'ASC X12 version 006020'},
]

/**
 * Development-only mock. All content here is synthetic and exists purely to make
 * the CLI runnable; it is not real licensed X12 reference data.
 */
export class MockApiClient implements ApiClient {
  readonly isMock = true

  constructor(private readonly opts: ApiClientOptions) {}

  private requireToken(): void {
    if (!this.opts.token) throw new NotAuthenticatedError()
  }

  private render(kind: string, id: string, req: ReferenceRequest, lines: string[]): RenderedReference {
    const header =
      req.format === 'markdown'
        ? [`# ${kind} ${id}`, '', `> Release: ${req.release}`, '', '_(synthetic development data — not licensed X12 reference)_', '']
        : [`${kind} ${id}    [release ${req.release}]`, '']
    return {release: req.release, format: req.format, body: [...header, ...lines].join('\n')}
  }

  async x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render('Segment', id.toUpperCase(), req, [
      'Purpose: (synthetic) example segment for development.',
      '',
      'Elements:',
      '  01  Reference Identification Qualifier   ID   M',
      '  02  Reference Identification             AN   O',
    ])
  }

  async x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render('Element', id, req, [
      'Name: (synthetic) Example Element',
      'Type: ID   Min/Max: 1/3',
      '',
      'Codes (synthetic; showing 3):',
      '  AA  Example value A',
      '  BB  Example value B',
      '  CC  Example value C',
    ])
  }

  async x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    this.requireToken()
    return this.render('Transaction Set', id, req, [
      'Name: (synthetic) Example Transaction Set',
      '',
      'Loop structure:',
      '  Heading',
      '    ST  Transaction Set Header        M  1',
      '  Detail',
      '    HL  Hierarchical Level            M  >1',
      '  Summary',
      '    SE  Transaction Set Trailer       M  1',
    ])
  }

  async x12Releases(): Promise<ReleaseInfo[]> {
    return MOCK_RELEASES
  }

  async whoami(): Promise<Identity> {
    this.requireToken()
    return {organization: 'Acme EDI (dev)', keyScope: 'reference:read', keyHint: this.opts.token!.slice(-4)}
  }

  async startDeviceAuth(): Promise<DeviceAuthStart> {
    return {
      deviceCode: 'mock-device-code',
      userCode: 'WXYZ-1234',
      verificationUri: `${this.opts.baseUrl.replace(/\/$/, '')}/device`,
      interval: 1,
      expiresIn: 300,
    }
  }

  async pollDeviceAuth(_deviceCode: string): Promise<DeviceAuthPoll> {
    // The mock authorizes immediately so the login flow completes end to end.
    return {status: 'complete', token: 'mock-tedi-token-abcd'}
  }
}

// ---------------------------------------------------------------------------
// HTTP implementation (skeleton)
// ---------------------------------------------------------------------------

/**
 * Real HTTP client. Reference and identity calls are implemented against the
 * documented surface; device-authorization endpoints throw until the server ships
 * them (see the auth section of the brief).
 */
export class HttpApiClient implements ApiClient {
  readonly isMock = false

  constructor(private readonly opts: ApiClientOptions) {}

  private get base(): string {
    return this.opts.baseUrl.replace(/\/$/, '')
  }

  /** Map common error statuses to actionable errors, consistently across calls. */
  private assertOk(res: Response): void {
    if (res.status === 401) throw new NotAuthenticatedError()
    if (res.status === 403) throw new TermsNotAcceptedError()
    if (!res.ok) throw new TediError(`Tediware API request failed (${res.status} ${res.statusText}).`)
  }

  private async reference(path: string, req: ReferenceRequest): Promise<RenderedReference> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const url = new URL(`${this.base}${path}`)
    url.searchParams.set('release', req.release)
    url.searchParams.set('format', req.format)
    if (req.color) url.searchParams.set('color', 'true')

    const res = await fetchWithTimeout(url, {headers: {authorization: `Bearer ${this.opts.token}`}})
    this.assertOk(res)

    const body = await res.text()
    return {release: req.release, format: req.format, body}
  }

  x12Segment(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference(`/v1/x12/segments/${encodeURIComponent(id)}`, req)
  }

  x12Element(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference(`/v1/x12/elements/${encodeURIComponent(id)}`, req)
  }

  x12Transaction(id: string, req: ReferenceRequest): Promise<RenderedReference> {
    return this.reference(`/v1/x12/transactions/${encodeURIComponent(id)}`, req)
  }

  async x12Releases(): Promise<ReleaseInfo[]> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const res = await fetchWithTimeout(`${this.base}/v1/x12/releases`, {
      headers: {authorization: `Bearer ${this.opts.token}`},
    })
    this.assertOk(res)
    return (await res.json()) as ReleaseInfo[]
  }

  async whoami(): Promise<Identity> {
    if (!this.opts.token) throw new NotAuthenticatedError()
    const res = await fetchWithTimeout(`${this.base}/v1/identity`, {
      headers: {authorization: `Bearer ${this.opts.token}`},
    })
    this.assertOk(res)
    return (await res.json()) as Identity
  }

  async startDeviceAuth(): Promise<DeviceAuthStart> {
    throw new TediError('Device-authorization endpoints are not available yet.', {
      suggestions: ['Use the paste-key stopgap: `tedi auth login --key <api-key>`.'],
    })
  }

  async pollDeviceAuth(_deviceCode: string): Promise<DeviceAuthPoll> {
    throw new TediError('Device-authorization endpoints are not available yet.')
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Whether the mock client should be used. Mock is the default in the scaffold
 * (the real reference endpoints don't exist yet); disable it with any common
 * falsy value, e.g. `TEDI_API_MOCK=0` or `TEDI_API_MOCK=false`. This default
 * should flip to the HTTP client once the server endpoints ship.
 */
export function useMock(): boolean {
  const value = (process.env.TEDI_API_MOCK ?? '').trim().toLowerCase()
  if (value === '') return true
  return !['0', 'false', 'no', 'off'].includes(value)
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return useMock() ? new MockApiClient(opts) : new HttpApiClient(opts)
}
