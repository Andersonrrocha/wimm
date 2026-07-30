import { randomBytes } from 'node:crypto'

/**
 * HTTP header `SessionTokenGuard` reads the per-launch session token from.
 * Deliberately a header, never a query parameter: query strings are the
 * part of a URL that lands in access logs, in the `Referer` header sent to
 * any third-party resource a page subsequently loads, and in crash
 * reports -- a header set explicitly by the caller does not.
 */
export const SESSION_TOKEN_HEADER = 'x-wimm-session-token'

/**
 * Nest DI token the session token's expected value is registered under by
 * whoever composes `AppLocalModule` (see `AppLocalModuleOptions.sessionToken`
 * in `app.local.module.ts`), so `SessionTokenGuard` receives it through
 * constructor injection instead of a compile-time constant. A `Symbol`, not
 * a string, so it cannot collide with another provider token by accident.
 */
export const SESSION_TOKEN = Symbol('SESSION_TOKEN')

/**
 * Generates a fresh, cryptographically random session token for one launch
 * of the local composition root.
 *
 * Never written to disk, and this function does not accept or return
 * anything that would encourage that: the caller (Electron `main`, in a
 * later Phase 4b task; a test here) is expected to hold the returned value
 * in memory only, for the lifetime of the process that generated it, and
 * hand it to the renderer over IPC -- not a file, not an environment
 * variable, nothing that could end up captured in a crash report.
 *
 * 32 random bytes (256 bits) from `node:crypto`'s CSPRNG, hex-encoded.
 * Comfortably beyond what a brute-force guess against a loopback-only
 * listener needs to be infeasible, and a fixed, cheap size to compare with
 * `crypto.timingSafeEqual` (see `session-token.guard.ts`).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}
