/**
 * The ChatGPT plan-usage sign-in's one Electron-dependent piece: handing the
 * authorize URL to the user's **own** browser.
 *
 * `apps/api` names this capability (`OpenBrowser`, in
 * `ai/local-only/chatgpt-connect-flow.ts`) and deliberately owns no
 * implementation of it, so that package stays Electron-free and both
 * composition roots stay testable offline. This module is that
 * implementation, and `local-api.ts` is the only thing that passes it in --
 * see `AppLocalModule.forRoot`'s `openBrowser` option.
 *
 * **`shell.openExternal` only, never a `BrowserWindow`.** An embedded window
 * for a consent page is forbidden by the design, not merely discouraged: the
 * user must be able to see the real URL in a real address bar, use their own
 * ChatGPT session, their own password manager and their own extensions. A
 * window WIMM controls, asking for someone's ChatGPT password, is
 * indistinguishable from phishing even when it is honest -- and it would be
 * asking the user to take on faith exactly the thing the address bar exists
 * to prove. `chatgpt-browser.spec.ts` proves no `BrowserWindow` is ever
 * constructed, positively, by counting constructions rather than relying on
 * the absence of a crash.
 *
 * **Why this refuses a URL at all, when it is handed one by WIMM's own API.**
 * `shell.openExternal` is a navigation primitive: whatever string reaches it
 * is opened, with the OS's choice of handler, under the user's identity. The
 * string this one receives originates in the OIDC discovery document's
 * `authorization_endpoint` -- fetched over the network, and therefore the one
 * input on this path an attacker could hope to influence. This function is
 * the last place that can be stopped, so it is where the check belongs.
 */
import { shell } from 'electron'

import { CHATGPT_ISSUER } from '@wimm/api/dist/ai/local-only/chatgpt-oidc'

/**
 * The only origin an authorize URL may have: the issuer's, parsed from
 * `@wimm/api`'s own `CHATGPT_ISSUER` rather than re-spelled here, so the two
 * cannot drift apart.
 *
 * **A parsed `origin` comparison, not a `startsWith` and not a hostname
 * check.** `'https://auth.openai.com.evil.example/authorize'.startsWith(
 * 'https://auth.openai.com')` is `true`, and a hostname-only check accepts
 * plain `http://auth.openai.com/authorize` -- the authorize URL carries
 * `state` and `code_challenge` and the user is about to type a password into
 * whatever answers, so neither near-miss may pass. `URL.origin` folds scheme,
 * host and port into one value and is the only comparison that rejects both.
 *
 * **This is deliberately stricter than Task 3's discovery hardening**, which
 * requires `https:` on every discovered endpoint but does *not* require them
 * to be same-origin -- `jwks_uri` may legitimately live on a CDN, and
 * asserting otherwise would risk breaking the live flow for no security gain,
 * since a JWKS fetch is machine-to-machine. The authorize URL is the
 * exception: it is the one endpoint a *human* is sent to, so a wrong origin is
 * a phishing vector and failing closed is right. If OpenAI ever serves
 * authorize from another origin, this is the line that breaks -- loudly,
 * which is the intent. A silent degradation here would mean sending users to
 * an unverified origin.
 */
const ISSUER_ORIGIN = new URL(CHATGPT_ISSUER).origin

/**
 * Static, and that is the point.
 *
 * `ChatGptConnectFlow.connect` rethrows whatever this function throws, and
 * Nest's default exception filter logs a non-`HttpException`'s stack -- so a
 * message built by interpolating the URL would write `state` and
 * `code_challenge` into the log. Neither is on any prohibited list and
 * `code_challenge` is public by design, but this is the one new log surface
 * this module opens and a static message costs nothing.
 *
 * For the same reason neither error below carries a `cause`: Node prints a
 * cause's own message alongside the error, so attaching the underlying
 * `openExternal` rejection (whose text routinely quotes the URL it could not
 * open) would reintroduce exactly what these constants exist to avoid.
 */
const REFUSED_MESSAGE =
  'Refusing to open the ChatGPT authorize URL: its origin is not the expected issuer. ' +
  'The URL is deliberately omitted from this message.'

const OPEN_FAILED_MESSAGE =
  'Could not hand the ChatGPT authorize URL to the system browser. ' +
  'The URL is deliberately omitted from this message.'

/**
 * Opens `url` in the user's own browser, and resolves once it has been handed
 * over -- not once the user is finished with it. That is `OpenBrowser`'s
 * contract (see its doc comment in `apps/api`): the connect flow arms its
 * loopback listener *before* calling this and waits on that listener, not on
 * this promise.
 *
 * Rejects without opening anything if `url` is unparseable or its origin is
 * not the issuer's. Rejects with a static message if `shell.openExternal`
 * itself fails -- which it genuinely does, in the ordinary case of a machine
 * with no registered handler for `https:`, so that path is real and not
 * defensive padding.
 */
export async function openChatGptAuthorizeUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(REFUSED_MESSAGE)
  }

  if (parsed.origin !== ISSUER_ORIGIN) {
    throw new Error(REFUSED_MESSAGE)
  }

  try {
    await shell.openExternal(url)
  } catch {
    throw new Error(OPEN_FAILED_MESSAGE)
  }
}
