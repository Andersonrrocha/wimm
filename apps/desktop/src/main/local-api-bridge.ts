/**
 * Forwards one renderer-originated request to the embedded local API,
 * running in **main**, on behalf of the `local-api:request` IPC handler
 * registered in `index.ts`.
 *
 * **Why this is a separate hop instead of the renderer calling the embedded
 * API directly.** The local composition (`AppLocalModule`, booted by
 * `startLocalApi`) authenticates every request with a per-launch session
 * token in a custom header (`SESSION_TOKEN_HEADER` -- see
 * `session-token.ts`). A custom header cannot be attached to a cross-origin
 * request without a successful CORS preflight, and the embedded API
 * deliberately sends no CORS headers at all: adding a permissive CORS policy
 * to let the renderer call it directly would let *any* page the browser
 * loads -- including one a DNS-rebinding attacker resolves to `127.0.0.1` --
 * complete that same preflight and read the same token back, which is
 * exactly the protection the token exists to provide. A scoped allowlist
 * does not fix this either: a packaged renderer is loaded from `file://`,
 * whose `Origin` header is the literal string `null`, and a CORS policy that
 * allows `null` allows every origin.
 *
 * Routing through main instead sidesteps the question entirely. This module
 * issues the real HTTP request itself, as a plain same-process `fetch` call
 * (no browser, no `Origin` header, no CORS involved at all), and injects the
 * session token here -- **the renderer never receives, stores, or forwards
 * it**. Even a fully compromised renderer (arbitrary injected script, a
 * malicious dependency, a DNS-rebound page if one somehow reached the
 * renderer's origin) has no token to exfiltrate, because it was never
 * handed one. It only ever has `window.localApi.request(...)`, which crosses
 * into main and back.
 *
 * **Why this is a separate module from `local-api.ts`.** `local-api.ts` owns
 * booting the embedded API (Task 2 of this phase); this module owns
 * forwarding requests *to* an already-running one (Task 3). Keeping them
 * separate means this file's tests do not need to duplicate `local-api.ts`'s
 * profile/migration bootstrap concerns -- they only need a running
 * `LocalApiHandle` (or, in this file's own tests, the minimal
 * `{ port, token }` shape this module actually depends on) to exercise real
 * request/response behaviour against.
 */
import { SESSION_TOKEN_HEADER } from '@wimm/api/dist/profile/session-token'
import type {
  LocalApiRequestPayload,
  LocalApiResponsePayload,
  SerializedFormData,
} from '../shared/local-api-protocol'

/** The subset of `LocalApiHandle` (`local-api.ts`) this module actually needs. */
export interface LocalApiConnection {
  port: number
  token: string
}

function isSerializedFormData(data: unknown): data is SerializedFormData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __wimmFormData?: unknown }).__wimmFormData === true
  )
}

/**
 * Turns `payload.data` into a `fetch` body, and reports the `Content-Type`
 * it implies (if any) so the caller can set that header only when the body
 * actually needs one -- a GET/HEAD request has no body and no
 * `Content-Type` at all.
 *
 * A `SerializedFormData` body (see `local-api-protocol.ts`) is reconstructed
 * into a real `FormData`/`Blob` pair here, in main, from the raw bytes the
 * renderer's adapter sent over IPC -- deliberately no explicit
 * `Content-Type` is returned for this case, since `fetch` computes the
 * multipart boundary itself from the `FormData` instance, and setting one by
 * hand here would almost certainly omit or mismatch that boundary. Anything
 * else is treated as a JSON-serializable value, mirroring what the
 * renderer's axios instance already assumes for every non-`FormData` request
 * body today.
 */
function buildRequestBody(data: unknown): { body?: FormData | string; contentType?: string } {
  if (data === undefined) {
    return {}
  }

  if (isSerializedFormData(data)) {
    const form = new FormData()
    for (const part of data.parts) {
      if (part.kind === 'field') {
        form.append(part.name, part.value)
      } else {
        form.append(part.name, new Blob([part.bytes], { type: part.mimeType }), part.fileName)
      }
    }
    return { body: form }
  }

  return { body: JSON.stringify(data), contentType: 'application/json' }
}

/** Builds the full request URL against the embedded API's actual loopback port, applying `payload.params` as a query string. */
function buildUrl(port: number, payload: LocalApiRequestPayload): URL {
  const url = new URL(payload.path, `http://127.0.0.1:${port}`)
  if (payload.params) {
    for (const [key, value] of Object.entries(payload.params)) {
      if (value !== undefined) {
        url.searchParams.append(key, String(value))
      }
    }
  }
  return url
}

/**
 * Issues `payload` as a real HTTP request against the embedded API described
 * by `connection`, and relays the response back verbatim.
 *
 * **Always overwrites, never merges, the session token header.** Whatever
 * `payload.headers` contains, `SESSION_TOKEN_HEADER` is set to
 * `connection.token` unconditionally afterwards. The renderer's adapter
 * never sends this header at all (it has no token to send -- see the module
 * doc comment), so in practice there is nothing to overwrite; the explicit
 * overwrite exists as defense in depth against a future caller mistake, so
 * the one value that is actually allowed to authenticate a request is always
 * the real, in-memory, per-launch token, never something a caller supplied.
 *
 * A GET/HEAD request is sent with no body regardless of `payload.data`,
 * matching `fetch`'s own restriction (a body on GET/HEAD throws).
 *
 * Never throws for a non-2xx response -- 401/404/500/... are all returned as
 * an ordinary `LocalApiResponsePayload` with that status, exactly like a real
 * HTTP client would report them. It is the renderer's axios adapter's job
 * (see `local-api-adapter.ts`) to turn a non-2xx status into a rejected
 * promise, the same way axios's own built-in adapters do -- this function
 * only relays what actually happened over the wire.
 */
export async function forwardLocalApiRequest(
  connection: LocalApiConnection,
  payload: LocalApiRequestPayload,
): Promise<LocalApiResponsePayload> {
  const url = buildUrl(connection.port, payload)
  const method = payload.method.toUpperCase()
  const { body, contentType } = buildRequestBody(payload.data)

  const headers = new Headers(payload.headers ?? {})
  if (contentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', contentType)
  }
  headers.set(SESSION_TOKEN_HEADER, connection.token)

  const isBodyless = method === 'GET' || method === 'HEAD'
  const response = await fetch(url, {
    method,
    headers,
    body: isBodyless ? undefined : body,
  })

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  // The embedded API's responses are always either JSON or empty (a 204, or
  // a 401 with no body) -- never HTML or a binary payload, since nothing in
  // this build downloads a file through this path. Parsed leniently rather
  // than trusting the response's own Content-Type, so an empty body never
  // trips `JSON.parse`'s "Unexpected end of JSON input".
  const text = await response.text()
  let data: unknown
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    data,
  }
}
