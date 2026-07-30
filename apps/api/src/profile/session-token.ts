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

/**
 * Throws unless `token` is usable as a session token: a string that is not
 * empty and not entirely whitespace.
 *
 * **Where this is called, and why that call site cannot be bypassed.**
 * `AppLocalModule.forRoot` calls this as its first statement, before
 * building or returning the `DynamicModule` -- see that method. `forRoot`
 * is the *only* way to compose this application root; there is no second,
 * legitimate entry point that skips it, and by the time `SessionTokenGuard`
 * would otherwise be the first thing to touch this value (on the very
 * first incoming request, deep inside `constantTimeEqual`'s
 * `createHash().update()`), the misconfiguration has already turned into a
 * silent, permanent failure mode: a `''`/whitespace token makes the guard
 * reject every request forever (the app "boots" and then never works,
 * with no indication why), and `undefined` throws inside `createHash`,
 * producing a bare Nest 500 instead of the guard's documented 401. Both are
 * failures that belong at boot, where they name the actual problem, not
 * at request time, where they look like something else went wrong.
 *
 * Takes `unknown`, not `string`: `AppLocalModuleOptions.sessionToken` is
 * typed `string`, but nothing at runtime enforces that against a caller
 * that ignores or casts around the type checker -- exactly the case this
 * function exists to catch.
 *
 * **No minimum length.** Length alone cannot distinguish a strong token
 * from a weak one -- a 64-character string of one repeated character is
 * exactly as guessable as a 4-character one, so a length floor would buy
 * false confidence, not real entropy, and there is no principled number to
 * pick. Real strength is `generateSessionToken`'s job (32 random bytes from
 * `node:crypto`'s CSPRNG), not this function's: it can only meaningfully
 * tell "obviously not a token" (missing, empty, whitespace) apart from
 * "some string was supplied", not judge how good that string is. The
 * shorter, fixed literals existing specs already use as test fixtures
 * (e.g. `app.local.module.spec.ts`'s `TEST_SESSION_TOKEN`) are legitimate
 * and would have no principled reason to start failing here.
 *
 * **No silent trimming.** `token.trim().length === 0` is used only to
 * *detect* a whitespace-only value -- the token itself is never trimmed or
 * otherwise modified before being accepted. A token that *needed* trimming
 * to be meaningful (stray leading/trailing whitespace from a copy-paste or
 * a template literal) is a caller bug: silently stripping it here would
 * make that bug invisible while producing a guard that only accepts the
 * untrimmed value, which is not what any legitimate caller would send.
 *
 * Never includes the received value in the thrown message -- only its
 * type, or the fact that it was empty/whitespace.
 */
export function assertUsableSessionToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || token.trim().length === 0) {
    const description =
      typeof token !== 'string'
        ? `a ${token === null ? 'null' : typeof token} value`
        : 'an empty or whitespace-only string'

    throw new Error(
      `AppLocalModule.forRoot: refusing to compose the local API without a usable session token -- ` +
        `sessionToken must be a non-empty, non-whitespace string, but received ${description}. ` +
        'Generate one with generateSessionToken() (profile/session-token.ts) and hold it in memory for ' +
        'the lifetime of this launch -- never persist it, hardcode it, or leave it unset.',
    )
  }
}
