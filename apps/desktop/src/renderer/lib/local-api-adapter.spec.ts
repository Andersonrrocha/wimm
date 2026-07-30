import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
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
})
