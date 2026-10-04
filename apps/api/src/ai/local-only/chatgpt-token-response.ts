/**
 * Reading an OAuth token response, shared by the authorization-code exchange
 * (`chatgpt-token-exchange.ts`) and the refresh grant
 * (`chatgpt-refresh.service.ts`).
 *
 * Both parse the same shape and clamp `expires_in` the same way, which is the
 * second use and therefore the point at which `AGENTS.md` says to abstract.
 *
 * The distinct error messages are deliberate -- they say *which* parse failed
 * -- so the label is a parameter rather than being flattened into one string.
 *
 * Deliberately NOT shared: the scope fallback. The exchange falls back to
 * `CHATGPT_SCOPES` (what was requested, per RFC 6749 section 5.1) and the
 * refresh falls back to the stored scopes (what was previously granted).
 * Those are two different behaviours that happen to have one shape, and
 * merging them would force a single fallback where two are needed.
 */

/** A year: far beyond any real access-token lifetime. */
export const MAX_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60

/**
 * The response body as a plain object, or a throw carrying only `label`.
 *
 * `json()` on a malformed body quotes its first characters, and these bodies
 * carry tokens -- so a parse error could otherwise put a fragment of one into
 * the message. A JSON `null` is rejected too, since it would make every field
 * read downstream throw a raw `TypeError`.
 */
export async function readJsonObject(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error(`${label} could not be parsed.`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${label} was not an object.`)
  }
  return parsed as Record<string, unknown>
}

/**
 * `expires_in` as a usable number of seconds, or `0`.
 *
 * Clamped, because `Number.isFinite` alone is not enough: `1e13` produces an
 * `Invalid Date`, and every later `expiresAt <= now` comparison is false for
 * `NaN` -- so the credential would read as never expiring.
 */
export function readExpiresInSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_EXPIRES_IN_SECONDS)
    : 0
}
