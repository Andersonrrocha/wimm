import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import type { LocalApiRequestPayload, LocalApiResponsePayload } from '../../shared/local-api-protocol'
import {
  createLocalApiAdapter,
  encodeRequestData,
  resolveLocalApiPath,
  type LocalApiRequestBridge,
} from './local-api-adapter'

function baseConfig(overrides: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig {
  return {
    baseURL: 'http://localhost:3000/api',
    url: '/sources',
    method: 'get',
    headers: AxiosHeaders.from({}),
    ...overrides,
  } as InternalAxiosRequestConfig
}

describe('resolveLocalApiPath', () => {
  it("prefixes the request's relative url with baseURL's path", () => {
    expect(resolveLocalApiPath(baseConfig({ url: '/sources' }))).toBe('/api/sources')
  })

  it('handles a baseURL with a trailing slash without producing a double slash', () => {
    expect(
      resolveLocalApiPath(baseConfig({ baseURL: 'http://localhost:3000/api/', url: '/categories' })),
    ).toBe('/api/categories')
  })

  it('tolerates a request url with no leading slash', () => {
    expect(resolveLocalApiPath(baseConfig({ url: 'users/me' }))).toBe('/api/users/me')
  })

  it('refuses an absolute request url rather than silently mis-forwarding it', () => {
    expect(() => resolveLocalApiPath(baseConfig({ url: 'https://evil.example.com/sources' }))).toThrow(
      /refusing to forward an absolute URL/,
    )
  })
})

describe('encodeRequestData', () => {
  it('passes a plain JSON-serializable value through unchanged', async () => {
    const data = { name: 'Groceries', type: 'EXPENSE' }
    await expect(encodeRequestData(data)).resolves.toBe(data)
  })

  it('passes undefined through unchanged (no body)', async () => {
    await expect(encodeRequestData(undefined)).resolves.toBeUndefined()
  })

  it("parses axios's own JSON-stringified body back into the original value", async () => {
    // `dispatchRequest` (axios core) always runs `config.transformRequest`
    // before any adapter -- custom adapters included -- sees `config.data`.
    // The default `transformRequest` JSON.stringifies a plain-object body
    // under a JSON content type (this app's `apiClient` default), so this is
    // exactly the shape `encodeRequestData` actually receives for an
    // ordinary `apiClient.post('/sources', { name, type })`-style call, not
    // the plain object the call site wrote.
    const original = { name: 'Banco Serrano', type: 'BANK_ACCOUNT' }
    const preStringifiedByAxios = JSON.stringify(original)
    await expect(encodeRequestData(preStringifiedByAxios)).resolves.toEqual(original)
  })

  it('forwards a non-JSON string body unchanged', async () => {
    await expect(encodeRequestData('not json at all')).resolves.toBe('not json at all')
  })

  it('encodes a FormData body into a SerializedFormData with matching field and file parts', async () => {
    const form = new FormData()
    form.append('sourceId', 'abc-123')
    const fileBytes = new TextEncoder().encode('date,description,amount\n2026-01-01,Coffee,-4.5\n')
    const file = new File([fileBytes], 'statement.csv', { type: 'text/csv' })
    form.append('file', file)

    const encoded = (await encodeRequestData(form)) as {
      __wimmFormData: true
      parts: Array<Record<string, unknown>>
    }

    expect(encoded.__wimmFormData).toBe(true)
    expect(encoded.parts).toEqual([
      { kind: 'field', name: 'sourceId', value: 'abc-123' },
      {
        kind: 'file',
        name: 'file',
        fileName: 'statement.csv',
        mimeType: 'text/csv',
        bytes: fileBytes,
      },
    ])
  })
})

describe('createLocalApiAdapter', () => {
  it('forwards method, path, params, and data to the bridge, and resolves with the response on a 2xx status', async () => {
    const response: LocalApiResponsePayload = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: [{ id: '1', name: 'Checking' }],
    }
    const request = jest.fn<Promise<LocalApiResponsePayload>, [LocalApiRequestPayload]>().mockResolvedValue(response)
    const bridge: LocalApiRequestBridge = { request }

    const config = baseConfig({
      method: 'get',
      url: '/sources',
      params: { page: 1 },
    })

    const result = await createLocalApiAdapter(bridge)(config)

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/sources', params: { page: 1 } }),
    )
    expect(result.status).toBe(200)
    expect(result.data).toEqual(response.data)
  })

  it('strips an Authorization header before it crosses into main', async () => {
    const response: LocalApiResponsePayload = {
      status: 200,
      statusText: 'OK',
      headers: {},
      data: [],
    }
    const request = jest.fn<Promise<LocalApiResponsePayload>, [LocalApiRequestPayload]>().mockResolvedValue(response)
    const bridge: LocalApiRequestBridge = { request }

    const config = baseConfig({
      headers: AxiosHeaders.from({ Authorization: 'Bearer should-never-cross' }),
    })

    await createLocalApiAdapter(bridge)(config)

    const forwarded = request.mock.calls[0][0]
    expect(forwarded.headers).not.toHaveProperty('Authorization')
    expect(forwarded.headers).not.toHaveProperty('authorization')
  })

  it('rejects with an AxiosError carrying the response when the bridge reports a non-2xx status', async () => {
    const response: LocalApiResponsePayload = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      data: { message: 'Unauthorized' },
    }
    const bridge: LocalApiRequestBridge = { request: jest.fn().mockResolvedValue(response) }

    const config = baseConfig()

    await expect(createLocalApiAdapter(bridge)(config)).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    })
  })

  /**
   * Regression test for a real bug found end to end while proving Stage 2
   * Task 5's "Save mapping" button against a packaged build: every test
   * above builds an `InternalAxiosRequestConfig` by hand, with `data` still
   * the plain object a call site wrote -- none of them go through a real
   * axios instance's own request pipeline, which unconditionally runs
   * `config.transformRequest` (JSON.stringifying a plain-object JSON body)
   * *before* handing `config` to ANY adapter, custom ones included. That
   * blind spot is exactly why this bug went unnoticed: a real
   * `apiClient.post('/sources', { name, type })` call reached
   * `createLocalApiAdapter` with `data` already serialized to a JSON
   * *string* -- forwarding it unchanged (this suite's previous behaviour)
   * made `forwardLocalApiRequest` (`local-api-bridge.ts`, main)
   * double-encode it, and the embedded API's body-parser rejected the
   * result outright. This test installs the adapter on a REAL `axios`
   * instance and posts a plain object exactly like `api-client.ts` does, so
   * it fails the same way the real bug did if `encodeRequestData` ever
   * regresses to passing an axios-pre-stringified body through unchanged
   * again.
   */
  it('round-trips a real axios POST body through the real transformRequest pipeline without double-encoding it', async () => {
    const response: LocalApiResponsePayload = {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      data: { id: 'new-source-id' },
    }
    const request = jest.fn<Promise<LocalApiResponsePayload>, [LocalApiRequestPayload]>().mockResolvedValue(response)
    const bridge: LocalApiRequestBridge = { request }

    const client = axios.create({
      baseURL: 'http://localhost:3000/api',
      headers: { 'Content-Type': 'application/json' },
      adapter: createLocalApiAdapter(bridge),
    })

    const body = { name: 'Banco Serrano', type: 'BANK_ACCOUNT' }
    const result = await client.post('/sources', body)

    const forwarded = request.mock.calls[0][0]
    // The load-bearing assertion: `payload.data` must be the real object
    // (what `forwardLocalApiRequest` will JSON.stringify exactly once), never
    // the JSON *string* axios's own `transformRequest` already produced.
    expect(forwarded.data).toEqual(body)
    expect(typeof forwarded.data).not.toBe('string')
    expect(result.status).toBe(201)
    expect(result.data).toEqual({ id: 'new-source-id' })
  })
})
