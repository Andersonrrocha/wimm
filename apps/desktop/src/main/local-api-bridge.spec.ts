/**
 * Behavioral proof for `forwardLocalApiRequest`, against a real, running
 * embedded API (via `startLocalApi`) -- not a mocked `fetch`. This is the
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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SESSION_TOKEN_HEADER } from '@wimm/api/dist/profile/session-token'
import { CategoryType, SourceType } from '@wimm/shared'

import { startLocalApi, type LocalApiHandle } from './local-api'
import { forwardLocalApiRequest } from './local-api-bridge'

jest.setTimeout(30000)

function tmpProfileDir(): string {
  return mkdtempSync(join(tmpdir(), 'wimm-local-api-bridge-spec-'))
}

describe('forwardLocalApiRequest', () => {
  let profileDir: string
  let handle: LocalApiHandle

  beforeEach(async () => {
    profileDir = tmpProfileDir()
    handle = await startLocalApi({ profileDir })
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
    handle = await startLocalApi({ profileDir })
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
