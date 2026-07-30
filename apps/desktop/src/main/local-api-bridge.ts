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
 *
 * **The "the renderer has no token to exfiltrate" property above is only as
 * strong as this module's own validation of `payload`.** `payload` crosses
 * the IPC boundary from the renderer -- the untrusted side of it -- and
 * before Finding 1 of the phase 4b security review, `payload.path` was
 * handed straight to `new URL(path, base)` with no check at all: an
 * absolute (`"http://attacker.example/exfil"`) or protocol-relative
 * (`"//attacker.example/exfil2"`) value replaces `base` entirely, which made
 * this module -- running in main, with the real session token -- issue that
 * request, headers and all, to whatever host the string named. A compromised
 * renderer does not need the token if it can make main mail it out. `buildUrl`,
 * `assertAllowedMethod`, and `buildAllowedHeaders` below are what closes that:
 * every field of `payload` is now validated or allowlisted *in main* before
 * any request is issued, never trusted because a renderer-side check
 * (`local-api-adapter.ts`'s `resolveLocalApiPath`) already rejected an
 * absolute URL -- that check runs on the untrusted side of the boundary and
 * protects nothing on its own; `window.localApi.request` is reachable
 * directly from `window`, bypassing it entirely.
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
 * HTTP methods this bridge will actually issue -- the verbs this app's own
 * axios call sites use today (`GET`/`POST`/`PATCH`/`DELETE`, see
 * `api-client.ts`'s call sites) plus `PUT`, `HEAD`, and `OPTIONS`, the
 * remaining standard verbs axios's own `Method` type allows a caller to
 * request. Anything else -- `TRACE`, `CONNECT`, a made-up string -- is
 * rejected outright in `assertAllowedMethod` below, rather than handed to
 * `fetch` and to whatever the embedded API's router happens to do with it.
 */
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

/**
 * Request headers this bridge will actually forward from `payload.headers`.
 * Every other header a caller supplies -- a `Cookie`, an `Authorization`, or
 * anything else a compromised renderer might try to inject -- is silently
 * dropped in `buildAllowedHeaders` below. `SESSION_TOKEN_HEADER` is
 * deliberately not in this set: it is set unconditionally, from
 * `connection.token`, after this allowlist has already been applied, never
 * from `payload.headers` (see `forwardLocalApiRequest`'s doc comment).
 */
const ALLOWED_FORWARDED_HEADERS = new Set(['content-type', 'accept'])

/**
 * Throws unless `method` is one of `ALLOWED_METHODS`, otherwise returns it
 * uppercased. This is the second of the two allowlists this module enforces
 * against `payload` before it is allowed to become a real outgoing request
 * -- see `buildUrl`/`isSameOriginPath` for the first (the target).
 *
 * Exported (not just called internally) so `local-api-bridge.spec.ts` can
 * exercise the method allowlist directly, in addition to the end-to-end
 * proof through `forwardLocalApiRequest`.
 */
export function assertAllowedMethod(method: string): string {
  const upper = method.toUpperCase()
  if (!ALLOWED_METHODS.has(upper)) {
    throw new Error(
      `local-api-bridge: refusing to forward disallowed HTTP method ${JSON.stringify(method)} -- only ` +
        `${[...ALLOWED_METHODS].join(', ')} are allowed.`,
    )
  }
  return upper
}

/**
 * Builds the `Headers` this request will actually carry, keeping only the
 * entries of `payloadHeaders` whose name (case-insensitively) is in
 * `ALLOWED_FORWARDED_HEADERS`. Everything else is dropped here, before this
 * request is ever issued -- not merely overwritten later, the way the
 * session token is (see `forwardLocalApiRequest`) -- since there is no
 * legitimate value for e.g. a caller-supplied `Cookie` or `Authorization` to
 * ever reach the embedded API, or (had `payload.path` escaped this module's
 * origin check) any other host.
 *
 * Exported so `local-api-bridge.spec.ts` can assert the dropped headers
 * directly, without needing to inspect what the embedded API itself
 * received.
 */
export function buildAllowedHeaders(payloadHeaders: Record<string, string> | undefined): Headers {
  const headers = new Headers()
  if (payloadHeaders) {
    for (const [key, value] of Object.entries(payloadHeaders)) {
      if (ALLOWED_FORWARDED_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value)
      }
    }
  }
  return headers
}

/**
 * True only for a same-origin, absolute path: a leading `/` not followed by
 * a second `/`. This is the load-bearing check against `payload.path` --
 * the renderer-controlled, otherwise-unvalidated value `buildUrl` feeds
 * straight into `new URL(path, base)`.
 *
 * `new URL` treats an absolute URL (e.g. `"http://attacker.example/exfil"`)
 * or a protocol-relative one (`"//attacker.example/exfil2"`) as replacing
 * `base` entirely, rather than resolving against it -- either would make
 * this module issue its request, session token included, to whatever host
 * the string names, instead of the embedded API. Requiring exactly one
 * leading slash rules out both: an absolute URL has no leading slash at all
 * (it starts with a scheme), and a protocol-relative one starts with two.
 * A path that does not start with `/` at all (a bare relative reference,
 * e.g. `"attacker.example/exfil"`) is rejected by the same check, for the
 * same reason -- resolved against a base with a non-empty path it could
 * still land inside the embedded API, but this app's own call sites never
 * produce one (see `local-api-adapter.ts`'s `resolveLocalApiPath`), so there
 * is nothing legitimate to accommodate by allowing it.
 *
 * Exported for `local-api-bridge.spec.ts` to exercise directly.
 */
export function isSameOriginPath(path: string): boolean {
  return /^\/(?!\/)/.test(path)
}

/**
 * True if any path segment, once percent-decoded, is `..` -- a path
 * traversal attempt. Nothing this app's own call sites ever send needs one
 * (every route is a fixed literal, e.g. `/api/sources`), and the embedded
 * API is a plain HTTP router with no filesystem-path semantics of its own,
 * so a `..` segment can only be an attempt to reach something this path was
 * never meant to name. Malformed percent-encoding (a `%` that does not start
 * a valid escape) is treated the same as a literal `..`: a segment that
 * cannot be proven safe is not forwarded.
 *
 * Exported for `local-api-bridge.spec.ts` to exercise directly.
 */
export function containsTraversalSegment(path: string): boolean {
  return path.split('/').some((segment) => {
    if (segment.length === 0) return false
    try {
      return decodeURIComponent(segment) === '..'
    } catch {
      return true
    }
  })
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

/**
 * Builds the full request URL against the embedded API's actual loopback
 * port, applying `payload.params` as a query string -- but only once
 * `payload.path` has passed both checks above. This is the boundary Finding
 * 1 of the phase 4b security review identified as missing: `payload.path` is
 * renderer-controlled and, before this, unvalidated in main, so an absolute
 * or protocol-relative value here would have made this module's caller
 * (`forwardLocalApiRequest`) issue a real HTTP request -- session token
 * attached -- to an attacker-chosen host instead of the embedded API. See
 * `isSameOriginPath`'s doc comment for the full reasoning, and this
 * project's phase 4b security-fixes report for the reproduced attack and
 * the sink server's proven silence.
 *
 * The `url.origin` assertion after construction is intentionally redundant
 * with the checks above -- belt and braces. Given a same-origin,
 * traversal-free `payload.path`, `new URL(path, base)` cannot resolve to a
 * different origin than `base`, so this should be unreachable; it exists so
 * that if it is ever reached (a future change to either check above, or to
 * how `new URL` itself resolves a path), that regression fails loudly here
 * instead of silently reopening this proxy.
 */
function buildUrl(port: number, payload: LocalApiRequestPayload): URL {
  if (!isSameOriginPath(payload.path)) {
    throw new Error(
      `local-api-bridge: refusing to forward payload.path ${JSON.stringify(payload.path)} -- it must be a ` +
        'same-origin absolute path (a single leading "/"), never an absolute URL or a protocol-relative one.',
    )
  }
  if (containsTraversalSegment(payload.path)) {
    throw new Error(
      `local-api-bridge: refusing to forward payload.path ${JSON.stringify(payload.path)} -- it contains a ` +
        '".." path segment.',
    )
  }

  const expectedOrigin = `http://127.0.0.1:${port}`
  const url = new URL(payload.path, expectedOrigin)

  if (url.origin !== expectedOrigin) {
    throw new Error(
      `local-api-bridge: refusing to forward a request whose resolved origin (${url.origin}) does not match ` +
        `the embedded API's own origin (${expectedOrigin}) -- this should be unreachable given the checks ` +
        'above; see buildUrl\'s doc comment.',
    )
  }

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
 *
 * Throws synchronously, before issuing any request, if `payload` fails any
 * of the three allowlists this function enforces: `payload.path` must be a
 * same-origin absolute path with no `..` segment (`buildUrl`), `payload.method`
 * must be one of `ALLOWED_METHODS`, and only `payload.headers` entries in
 * `ALLOWED_FORWARDED_HEADERS` are forwarded (everything else is dropped, not
 * merely rejected as a whole request). See Finding 1 of the phase 4b
 * security review, and this project's security-fixes report for the
 * reproduced attacks these three checks close.
 */
export async function forwardLocalApiRequest(
  connection: LocalApiConnection,
  payload: LocalApiRequestPayload,
): Promise<LocalApiResponsePayload> {
  const method = assertAllowedMethod(payload.method)
  const url = buildUrl(connection.port, payload)
  const { body, contentType } = buildRequestBody(payload.data)

  const headers = buildAllowedHeaders(payload.headers)
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
