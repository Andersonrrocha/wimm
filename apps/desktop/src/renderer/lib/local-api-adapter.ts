/**
 * The axios adapter used in local mode: it replaces the default HTTP
 * transport entirely, and instead hands every request to `bridge.request`
 * (in practice, `window.localApi.request` -- see `preload/index.ts`), which
 * crosses into Electron main and issues the real HTTP call against the
 * embedded API from there.
 *
 * **Why a custom adapter instead of pointing axios's normal transport at
 * `http://127.0.0.1:<port>` directly.** The embedded API authenticates every
 * request with a per-launch session token carried in a custom header (see
 * `apps/api/src/profile/session-token.ts`), and deliberately sends no CORS
 * headers at all -- a custom header cannot be attached cross-origin without
 * a successful CORS preflight, and enabling permissive CORS just to make a
 * direct renderer `fetch` work would hand that same preflight (and the same
 * token) to any page that completes it, including one a DNS-rebinding
 * attacker resolves to `127.0.0.1`. A scoped allowlist does not fix this
 * either: the packaged renderer is `file://`, whose `Origin` is the literal
 * string `null`, and allowing `null` allows every origin.
 *
 * Routing through main instead means the renderer never dials the embedded
 * API's socket at all, and -- the property this design is actually for --
 * **never receives the session token**. `bridge.request`'s payload
 * (`LocalApiRequestPayload`, `local-api-protocol.ts`) has no field for a
 * credential of any kind; main attaches the real token itself, after this
 * adapter has already handed the request off. A fully compromised renderer
 * (arbitrary injected script, a malicious dependency) has nothing to
 * exfiltrate on this front, because it was never handed anything to
 * exfiltrate.
 */
import { AxiosError, AxiosHeaders } from 'axios'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type {
  LocalApiRequestPayload,
  LocalApiResponsePayload,
  SerializedFormData,
  SerializedFormDataPart,
} from '../../shared/local-api-protocol'

/** The one method of `window.localApi` this adapter actually needs -- kept narrow so tests can supply a minimal fake instead of the whole preload bridge shape. */
export interface LocalApiRequestBridge {
  request: (config: LocalApiRequestPayload) => Promise<LocalApiResponsePayload>
}

/** Axios's own default `validateStatus` (2xx succeeds, everything else rejects) -- a custom adapter does not inherit this for free, so it is reproduced here. */
function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Flattens `config.headers` into a plain string record for IPC transport,
 * and strips any `Authorization` header along the way. Local mode has no
 * token store and no bearer token to attach in the first place (see
 * `api-client.ts`'s request interceptor, which skips that step entirely in
 * local mode) -- this is a second, defensive line against the same thing,
 * in case some other interceptor is ever added upstream of this adapter
 * without realizing local mode has no use for it.
 */
function toHeaderRecord(headers: InternalAxiosRequestConfig['headers']): Record<string, string> {
  const record: Record<string, string> = {}
  const raw = AxiosHeaders.from(headers).toJSON()
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      record[key] = value
    }
  }
  delete record['Authorization']
  delete record['authorization']
  return record
}

/**
 * Computes the API path this request maps to, by combining the axios
 * instance's configured `baseURL` (e.g. `http://localhost:3000/api`) with
 * the request's own relative `url` (e.g. `/sources`) -- the same
 * `/sources`-style relative paths every call site in this app already
 * passes to `apiClient.get`/`.post`/etc. today, in both modes.
 *
 * Only `baseURL`'s *path* (`/api`) is reused; its host and port are never
 * dialed in local mode at all, since this adapter never opens a real socket
 * itself -- `bridge.request` does that, against the embedded API's actual
 * loopback port, which main already knows and this adapter does not need
 * to.
 *
 * Refuses (rather than silently mis-forwarding) an absolute request URL:
 * nothing in this app currently produces one, and forwarding it as-is would
 * either escape the embedded API silently or misinterpret an unrelated host
 * as a path segment.
 */
export function resolveLocalApiPath(config: InternalAxiosRequestConfig): string {
  const requestUrl = config.url ?? ''
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(requestUrl)) {
    throw new Error(
      `local API adapter: refusing to forward an absolute URL ("${requestUrl}") through IPC -- every call site ` +
        "in this app is expected to pass a path relative to the api client's baseURL.",
    )
  }

  const base = new URL(config.baseURL && config.baseURL.length > 0 ? config.baseURL : 'http://localhost/')
  const basePath = base.pathname.replace(/\/+$/, '')
  const relativePath = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`
  return `${basePath}${relativePath}`
}

async function encodeFormDataPart(name: string, value: string | File): Promise<SerializedFormDataPart> {
  if (typeof value === 'string') {
    return { kind: 'field', name, value }
  }
  const bytes = new Uint8Array(await value.arrayBuffer())
  return {
    kind: 'file',
    name,
    fileName: value.name,
    mimeType: value.type || 'application/octet-stream',
    bytes,
  }
}

/**
 * Encodes a request body for the IPC boundary. `contextBridge` can clone a
 * `Uint8Array` natively but cannot clone a `File`/`Blob` across the isolated
 * world, so a `FormData` body (file imports -- see `imports-page.tsx`) is
 * expanded into a `SerializedFormData`: each field becomes a plain string
 * part, each file becomes its raw bytes plus the metadata
 * (`forwardLocalApiRequest`, in main) needs to reconstruct an equivalent
 * `Blob`. Anything else is assumed to already be JSON-serializable, which is
 * everything else this app's api-client ever sends.
 *
 * **Undoes axios's own JSON pre-serialization for a plain-object body.**
 * `dispatchRequest` (axios core) always runs `config.transformRequest`
 * *before* handing `config` to any adapter -- custom adapters included --
 * and the default `transformRequest` `JSON.stringify`s a plain-object body
 * under a JSON content type (this app's `apiClient` sets exactly that
 * content type by default). So `data` here is already a JSON *string* for
 * every ordinary `apiClient.post('/sources', { name, type })`-style call,
 * not the plain object the call site wrote -- forwarding that string
 * unchanged would make `forwardLocalApiRequest`'s own `JSON.stringify(data)`
 * (`local-api-bridge.ts`, main) double-encode it into a JSON string *of* a
 * JSON string, which the embedded API's body-parser then rejects outright
 * (`"Unexpected token '\"'... is not valid JSON"`) -- silently breaking
 * every JSON POST/PUT/PATCH this app makes in local mode, discovered end to
 * end while proving Stage 2 Task 5's own `PUT /imports/csv-mapping/:sourceId`
 * save button actually persists anything against a real packaged build.
 * Parsing it back into a real value here is what keeps `LocalApiRequestPayload.data`
 * genuinely JSON-*shaped* on both sides of the IPC boundary, matching what
 * that type's own doc comment already promises -- a string that fails to
 * parse (not axios's own JSON encoding -- a caller-supplied raw string body,
 * or a non-JSON content type) is forwarded exactly as given, unchanged.
 */
export async function encodeRequestData(data: unknown): Promise<unknown> {
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    const parts: SerializedFormDataPart[] = []
    for (const [name, value] of data.entries()) {
      parts.push(await encodeFormDataPart(name, value))
    }
    const encoded: SerializedFormData = { __wimmFormData: true, parts }
    return encoded
  }
  if (typeof data === 'string' && data.length > 0) {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
  return data
}

/**
 * Builds the axios adapter installed in local mode. Mirrors what axios's own
 * built-in adapters do around status validation (a non-2xx response rejects
 * the returned promise with an `AxiosError`, exactly like today), so every
 * existing call site's `try`/`catch` and `.catch()` handling keeps working
 * unchanged regardless of which transport actually served the request.
 */
export function createLocalApiAdapter(bridge: LocalApiRequestBridge): AxiosAdapter {
  return async function localApiAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const path = resolveLocalApiPath(config)
    const data = await encodeRequestData(config.data)

    const response = await bridge.request({
      method: (config.method ?? 'get').toUpperCase(),
      path,
      data,
      params: config.params,
      headers: toHeaderRecord(config.headers),
    })

    const axiosResponse: AxiosResponse = {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: AxiosHeaders.from(response.headers),
      config,
      request: undefined,
    }

    const validateStatus = config.validateStatus ?? defaultValidateStatus
    if (validateStatus(response.status)) {
      return axiosResponse
    }

    throw new AxiosError(
      `Request failed with status code ${response.status}`,
      [AxiosError.ERR_BAD_REQUEST, AxiosError.ERR_BAD_RESPONSE][Math.floor(response.status / 100) - 4],
      config,
      undefined,
      axiosResponse,
    )
  }
}
