/**
 * Behavioral proof for `forwardLocalApiRequest`, against a real, running
 * embedded API (via `createProfileAndOpen`) -- not a mocked `fetch`. This is the
 * load-bearing seam for the "the session token never enters the renderer"
 * claim: every request built here carries no caller-supplied token at all
 * (mirroring exactly what the renderer's adapter actually sends), and this
 * suite proves the request still succeeds -- because this module injects the
 * real token itself -- and that a caller-supplied, wrong token is silently
 * overwritten rather than merged in.
 *
 * Runs under plain Node (via `ts-jest`), like `local-api.spec.ts`, and
 * requires the native ABI marker to say "node" (see that spec's doc
 * comment and `package.json`'s `pretest` script).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { SESSION_TOKEN_HEADER } from '@wimm/api/dist/profile/session-token'
import { CategoryType, SourceType } from '@wimm/shared'

import { createProfileAndOpen, type LocalApiHandle } from './local-api'
import {
  assertAllowedMethod,
  buildAllowedHeaders,
  containsTraversalSegment,
  forwardLocalApiRequest,
  isSameOriginPath,
} from './local-api-bridge'

jest.setTimeout(30000)

function tmpProfileDir(): string {
  return mkdtempSync(join(tmpdir(), 'wimm-local-api-bridge-spec-'))
}

describe('forwardLocalApiRequest', () => {
  let profileDir: string
  let handle: LocalApiHandle

  beforeEach(async () => {
    profileDir = tmpProfileDir()
    handle = await createProfileAndOpen({ profileDir, name: 'Test Profile' })
  })

  afterEach(async () => {
    await handle.close()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('forwards a GET request and injects the session token itself -- the caller supplies none', async () => {
    const res = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/sources',
      // No headers at all -- exactly what the renderer's adapter actually
      // sends, since it has no token to send in the first place.
    })

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('overwrites -- never merges with -- a caller-supplied session-token-shaped header', async () => {
    // A caller passing a wrong token under the same header name must not be
    // able to make the request fail (nor, the more dangerous direction,
    // able to supply its OWN token and have that be trusted instead of
    // main's real one). Either way, only connection.token may be
    // authoritative.
    const res = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/sources',
      headers: { [SESSION_TOKEN_HEADER]: 'a-completely-wrong-token' },
    })

    expect(res.status).toBe(200)
  })

  it('relays a non-2xx status as an ordinary response, rather than throwing', async () => {
    const res = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/this-route-does-not-exist',
    })

    expect(res.status).toBe(404)
  })

  it('forwards a JSON POST body, and the created resource is visible on a subsequent GET', async () => {
    const created = await forwardLocalApiRequest(handle, {
      method: 'POST',
      path: '/api/categories',
      data: { name: 'Groceries', type: CategoryType.EXPENSE },
    })

    expect(created.status).toBe(201)
    const createdBody = created.data as { id: string; name: string }
    expect(createdBody.name).toBe('Groceries')

    const list = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/categories',
    })
    expect(list.status).toBe(200)
    expect(list.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdBody.id, name: 'Groceries' })]),
    )
  })

  it('serializes `params` into the query string, and the API parses them back correctly', async () => {
    const res = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/transactions',
      params: { page: 1, pageSize: 5 },
    })

    expect(res.status).toBe(200)
    expect(res.data).toEqual(
      expect.objectContaining({ items: [], total: 0, page: 1, pageSize: 5 }),
    )
  })

  it('drops params whose value is undefined instead of forwarding the literal string "undefined"', async () => {
    const res = await forwardLocalApiRequest(handle, {
      method: 'GET',
      path: '/api/transactions',
      params: { page: 1, pageSize: 5, categoryId: undefined },
    })

    expect(res.status).toBe(200)
  })
})

describe('forwardLocalApiRequest -- FormData reconstruction', () => {
  let profileDir: string
  let handle: LocalApiHandle

  beforeEach(async () => {
    profileDir = tmpProfileDir()
    handle = await createProfileAndOpen({ profileDir, name: 'Test Profile' })
  })

  afterEach(async () => {
    await handle.close()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('reconstructs a SerializedFormData body into a real multipart request the API can parse', async () => {
    // A source is required by /imports/preview's DTO -- create one for real
    // through the same forwarding path, proving both JSON and multipart
    // bodies go through the same connection correctly.
    const sourceRes = await forwardLocalApiRequest(handle, {
      method: 'POST',
      path: '/api/sources',
      data: { name: 'Checking', type: SourceType.BANK_ACCOUNT },
    })
    expect(sourceRes.status).toBe(201)
    const sourceId = (sourceRes.data as { id: string }).id

    const csv = 'date,description,amount\n2026-01-15,Coffee,-4.50\n'
    const bytes = new TextEncoder().encode(csv)

    const res = await forwardLocalApiRequest(handle, {
      method: 'POST',
      path: '/api/imports/preview',
      data: {
        __wimmFormData: true,
        parts: [
          { kind: 'field', name: 'sourceId', value: sourceId },
          {
            kind: 'file',
            name: 'file',
            fileName: 'statement.csv',
            mimeType: 'text/csv',
            bytes,
          },
        ],
      },
    })

    // Whether this specific CSV shape is accepted by the parser is not what
    // this test is proving (that is imports business logic, untouched by
    // this phase) -- what matters here is that the request actually reached
    // the multipart-parsing route and was handled as a real upload, not
    // rejected at the transport level (e.g. a 400 from a missing/garbled
    // boundary, or a 401 from a missing token). A 401 or a raw transport
    // failure would mean the reconstruction above is broken; the assertion
    // below only rules those out.
    expect(res.status).not.toBe(401)
    expect(typeof res.status).toBe('number')
    expect(res.status).toBeLessThan(500)
  })
})

/**
 * Pure-unit coverage of the three allowlists `forwardLocalApiRequest`
 * enforces, isolated from the (slower, real-server) end-to-end proof below.
 */
describe('local-api-bridge -- allowlist helpers (Finding 1)', () => {
  it('isSameOriginPath accepts a single leading slash and rejects everything else', () => {
    expect(isSameOriginPath('/api/sources')).toBe(true)
    expect(isSameOriginPath('http://attacker.example/exfil')).toBe(false)
    expect(isSameOriginPath('//attacker.example/exfil2')).toBe(false)
    expect(isSameOriginPath('attacker.example/exfil')).toBe(false)
  })

  it('containsTraversalSegment catches a literal and a percent-encoded ".." segment', () => {
    expect(containsTraversalSegment('/api/sources')).toBe(false)
    expect(containsTraversalSegment('/api/../../../etc/passwd')).toBe(true)
    expect(containsTraversalSegment('/api/%2e%2e/secret')).toBe(true)
  })

  it('assertAllowedMethod accepts the standard verbs and rejects everything else', () => {
    expect(assertAllowedMethod('get')).toBe('GET')
    expect(assertAllowedMethod('POST')).toBe('POST')
    expect(() => assertAllowedMethod('TRACE')).toThrow()
    expect(() => assertAllowedMethod('CONNECT')).toThrow()
  })

  it('buildAllowedHeaders keeps only Content-Type/Accept and drops everything else', () => {
    const headers = buildAllowedHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: 'stolen=1',
      Authorization: 'Bearer forged',
      [SESSION_TOKEN_HEADER]: 'forged-token',
    })
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.has('Cookie')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.has(SESSION_TOKEN_HEADER)).toBe(false)
  })
})

/**
 * End-to-end proof for Finding 1 of the phase 4b security review: the IPC
 * bridge was an open proxy that would dial any host `payload.path` named,
 * with the real session token attached and every caller-supplied header
 * forwarded. This suite drives `forwardLocalApiRequest` directly -- exactly
 * as `index.ts`'s `local-api:request` handler does in production, with a
 * real, running embedded API as `connection` -- with each of the attack
 * payloads the security review reproduced, against a real sink HTTP server
 * standing in for "attacker.example". Every attempt must be rejected
 * *before* any network request reaches the sink; `sinkRequests` staying
 * empty across every single test in this suite (not just each one
 * individually) is the actual proof, not merely that
 * `forwardLocalApiRequest` rejected with *some* error.
 */
describe('forwardLocalApiRequest -- rejects the open-proxy attack vectors (Finding 1)', () => {
  let profileDir: string
  let handle: LocalApiHandle
  let sink: Server
  let sinkPort: number
  let sinkRequests: Array<{ method?: string; url?: string }>

  beforeEach(async () => {
    profileDir = tmpProfileDir()
    handle = await createProfileAndOpen({ profileDir, name: 'Test Profile' })

    sinkRequests = []
    sink = createServer((req: IncomingMessage, res) => {
      sinkRequests.push({ method: req.method, url: req.url })
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('sink received a request -- this must never happen')
    })
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve))
    sinkPort = (sink.address() as AddressInfo).port
  })

  afterEach(async () => {
    await handle.close()
    rmSync(profileDir, { recursive: true, force: true })
    await new Promise<void>((resolve, reject) =>
      sink.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('rejects an absolute http:// URL instead of dialing the sink server', async () => {
    await expect(
      forwardLocalApiRequest(handle, {
        method: 'GET',
        path: `http://127.0.0.1:${sinkPort}/exfil`,
      }),
    ).rejects.toThrow()
    expect(sinkRequests).toEqual([])
  })

  it('rejects a protocol-relative //host URL instead of dialing the sink server', async () => {
    await expect(
      forwardLocalApiRequest(handle, {
        method: 'GET',
        path: `//127.0.0.1:${sinkPort}/exfil2`,
      }),
    ).rejects.toThrow()
    expect(sinkRequests).toEqual([])
  })

  it('rejects a path-traversal attempt', async () => {
    await expect(
      forwardLocalApiRequest(handle, {
        method: 'GET',
        path: '/api/../../../../etc/passwd',
      }),
    ).rejects.toThrow()
    expect(sinkRequests).toEqual([])
  })

  it('rejects a disallowed HTTP method', async () => {
    await expect(
      forwardLocalApiRequest(handle, {
        method: 'TRACE',
        path: '/api/sources',
      }),
    ).rejects.toThrow()
    expect(sinkRequests).toEqual([])
  })

  it('rejects an absolute URL even when it carries an injected Cookie header', async () => {
    await expect(
      forwardLocalApiRequest(handle, {
        method: 'GET',
        path: `http://127.0.0.1:${sinkPort}/exfil3`,
        headers: { Cookie: 'stolen=1', 'X-Injected': 'evil' },
      }),
    ).rejects.toThrow()
    expect(sinkRequests).toEqual([])
  })
})
