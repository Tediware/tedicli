import assert from 'node:assert/strict'
import {afterEach, describe, it} from 'node:test'

import changelogHook from '../src/hooks/postrun/changelog.js'
import {fetchChangelog, parseRepoSlug} from '../src/lib/changelog.js'

const realFetch = globalThis.fetch

function stubFetch(handler: (url: string) => {status: number; body?: unknown}) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const {status, body} = handler(url)
    return new Response(body === undefined ? '' : JSON.stringify(body), {status})
  }) as typeof fetch
}

describe('parseRepoSlug', () => {
  it('parses https and git+ssh repository urls', () => {
    assert.equal(parseRepoSlug('https://github.com/tediware/tedicli.git'), 'tediware/tedicli')
    assert.equal(parseRepoSlug('git+https://github.com/tediware/tedicli.git'), 'tediware/tedicli')
    assert.equal(parseRepoSlug('git@github.com:tediware/tedicli.git'), 'tediware/tedicli')
  })

  it('keeps repo names that contain dots', () => {
    assert.equal(parseRepoSlug('https://github.com/vercel/next.js.git'), 'vercel/next.js')
    assert.equal(parseRepoSlug('https://github.com/socketio/socket.io'), 'socketio/socket.io')
  })

  it('returns undefined for non-github or missing urls', () => {
    assert.equal(parseRepoSlug(undefined), undefined)
    assert.equal(parseRepoSlug('https://example.com/foo/bar'), undefined)
  })
})

describe('fetchChangelog', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('returns the latest release entry', async () => {
    stubFetch(() => ({status: 200, body: {tag_name: 'v0.2.0', body: 'Notes here', html_url: 'https://gh/r'}}))
    const entry = await fetchChangelog('tediware/tedicli')
    assert.equal(entry?.version, 'v0.2.0')
    assert.equal(entry?.notes, 'Notes here')
    assert.equal(entry?.url, 'https://gh/r')
  })

  it('fetches the specific tag when a version is given', async () => {
    let requested = ''
    stubFetch((url) => {
      requested = url
      return {status: 200, body: {tag_name: 'v1.0.0', body: 'Pinned', html_url: 'https://gh/r'}}
    })
    const entry = await fetchChangelog('tediware/tedicli', {version: 'v1.0.0'})
    assert.match(requested, /releases\/tags\/v1\.0\.0$/)
    assert.equal(entry?.version, 'v1.0.0')
  })

  it('finds a v-prefixed tag when given an unprefixed npm version', async () => {
    // npm versions are unprefixed (1.2.3) but the GitHub release tag is v1.2.3.
    const seen: string[] = []
    stubFetch((url) => {
      seen.push(url)
      return url.endsWith('/tags/v1.2.3')
        ? {status: 200, body: {tag_name: 'v1.2.3', body: 'notes', html_url: 'https://gh/r'}}
        : {status: 404}
    })
    const entry = await fetchChangelog('tediware/tedicli', {version: '1.2.3'})
    assert.equal(entry?.version, 'v1.2.3')
    assert.ok(seen.some((u) => u.endsWith('/tags/1.2.3')), 'tries the raw version first')
    assert.ok(seen.some((u) => u.endsWith('/tags/v1.2.3')), 'falls through to the v-prefixed tag')
  })

  it('returns undefined (no fallback to latest) when no tag variant exists', async () => {
    stubFetch(() => ({status: 404}))
    assert.equal(await fetchChangelog('tediware/tedicli', {version: 'v9.9.9'}), undefined)
  })

  it('returns undefined on a failed request', async () => {
    stubFetch(() => ({status: 500}))
    assert.equal(await fetchChangelog('tediware/tedicli'), undefined)
  })
})

describe('changelog postrun hook', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function ctxFor(logs: string[]) {
    return {log: (m = '') => logs.push(m)}
  }

  const stringRepoConfig = {version: '0.0.0', userAgent: 'tedi/0.0.0', pjson: {repository: 'https://github.com/tediware/tedicli.git'}}
  const objectRepoConfig = {
    version: '0.0.0',
    userAgent: 'tedi/0.0.0',
    pjson: {repository: {type: 'git', url: 'https://github.com/tediware/tedicli.git'}},
  }

  async function runHook(opts: Record<string, unknown>): Promise<string[]> {
    const logs: string[] = []
    await changelogHook.call(ctxFor(logs) as never, opts as never)
    return logs
  }

  it('prints the changelog after the update command (string repository)', async () => {
    stubFetch(() => ({status: 200, body: {tag_name: 'v0.2.0', body: 'Shiny new things', html_url: 'https://gh/r'}}))
    const out = (await runHook({Command: {id: 'update'}, config: stringRepoConfig})).join('\n')
    assert.match(out, /v0\.2\.0/)
    assert.match(out, /Shiny new things/)
  })

  it('handles the object form of repository (matches the real package.json)', async () => {
    stubFetch(() => ({status: 200, body: {tag_name: 'v0.2.0', body: 'From object repo', html_url: 'https://gh/r'}}))
    const out = (await runHook({Command: {id: 'update'}, config: objectRepoConfig})).join('\n')
    assert.match(out, /From object repo/)
  })

  it('passes --version through to fetch the matching tag', async () => {
    let requested = ''
    stubFetch((url) => {
      requested = url
      return {status: 200, body: {tag_name: '1.0.0', body: 'Pinned notes', html_url: 'https://gh/r'}}
    })
    const out = (await runHook({Command: {id: 'update'}, argv: ['--version', '1.0.0'], config: stringRepoConfig})).join('\n')
    assert.match(requested, /releases\/tags\/1\.0\.0$/)
    assert.match(out, /Pinned notes/)
  })

  it('skips when nothing was installed (--available)', async () => {
    let fetched = false
    stubFetch(() => {
      fetched = true
      return {status: 200, body: {tag_name: 'v0.2.0'}}
    })
    const logs = await runHook({Command: {id: 'update'}, argv: ['--available'], config: stringRepoConfig})
    assert.equal(fetched, false)
    assert.equal(logs.length, 0)
  })

  it('skips when already on the latest version', async () => {
    stubFetch(() => ({status: 200, body: {tag_name: 'v0.0.0', body: 'same version'}}))
    const logs = await runHook({Command: {id: 'update'}, config: stringRepoConfig})
    assert.equal(logs.length, 0)
  })

  it('does nothing for non-update commands', async () => {
    let fetched = false
    stubFetch(() => {
      fetched = true
      return {status: 200, body: {tag_name: 'v0.2.0'}}
    })
    const logs = await runHook({Command: {id: 'whoami'}, config: stringRepoConfig})
    assert.equal(fetched, false)
    assert.equal(logs.length, 0)
  })
})
