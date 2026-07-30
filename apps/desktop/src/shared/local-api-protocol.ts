/**
 * Wire contract for the local-mode IPC adapter, shared between the renderer
 * (the axios adapter that produces requests and consumes responses), the
 * preload bridge (which only relays these shapes across `contextBridge`,
 * never inspects them), and main (which actually issues the HTTP request
 * against the embedded API and injects the session token).
 *
 * **Why this exists as its own module.** Keeping the wire shape in one place
 * that both sides import prevents the renderer and main from drifting into
 * two different ideas of what a request or response looks like -- exactly
 * the kind of mismatch that would surface only at runtime, as a confusing
 * IPC failure or a silently wrong request.
 *
 * **The session token never appears anywhere in this file.** Every type here
 * describes what crosses the *renderer <-> main* boundary; the token only
 * ever exists on the *main <-> embedded API* leg (see
 * `local-api-bridge.ts`'s `forwardLocalApiRequest`), which these types have
 * no visibility into. That is deliberate, not an oversight: see this
 * project's phase 4b task 3 report for the full reasoning.
 */

/**
 * Reported by main over IPC so the renderer never has to guess or read an
 * env var to know which transport to use. `'local'` means main booted the
 * embedded API and every request must go through it; `'hosted'` means it did
 * not (or does not exist in this build) and the renderer's existing
 * `API_BASE_URL` HTTP path is used exactly as before.
 */
export type ApiMode = { mode: 'local' } | { mode: 'hosted' }

/**
 * One part of a `FormData` body, encoded so it survives `contextBridge`'s
 * structured-clone boundary. A plain string field carries `value` directly;
 * a file field carries its bytes as a `Uint8Array` (structured-clone
 * transfers typed arrays natively, unlike `File`/`Blob`, which contextBridge
 * cannot clone across the isolated world boundary) plus the metadata needed
 * to reconstruct an equivalent `Blob` in main.
 */
export type SerializedFormDataPart =
  | { kind: 'field'; name: string; value: string }
  | {
      kind: 'file'
      name: string
      fileName: string
      mimeType: string
      bytes: Uint8Array
    }

/**
 * A `FormData` body, encoded for IPC transport. The `__wimmFormData`
 * discriminant (rather than, say, `Array.isArray`) is what lets main tell
 * "this is an encoded multipart body" apart from "this is a JSON-serializable
 * array the caller happened to POST" -- both are plain objects/arrays by the
 * time they cross IPC, so the discriminant has to be explicit.
 */
export type SerializedFormData = {
  __wimmFormData: true
  parts: SerializedFormDataPart[]
}

/** Everything a request body can be once JSON-shaped data and `FormData` are both accounted for. */
export type SerializedRequestBody = SerializedFormData | unknown

/**
 * One outgoing request, as the renderer's axios adapter hands it to the
 * preload bridge. `path` already includes whatever prefix the API serves
 * under (e.g. `/api/sources`) -- computed by the renderer from its existing
 * `API_BASE_URL`, so a change to that base URL's path continues to apply in
 * local mode without touching this contract.
 *
 * Deliberately has no field for a credential of any kind: the renderer does
 * not have the session token and cannot supply one. See
 * `forwardLocalApiRequest` for where the real token is attached.
 */
export interface LocalApiRequestPayload {
  method: string
  path: string
  data?: SerializedRequestBody
  params?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
}

/** The embedded API's response, relayed back to the renderer's adapter as-is. */
export interface LocalApiResponsePayload {
  status: number
  statusText: string
  headers: Record<string, string>
  data: unknown
}
