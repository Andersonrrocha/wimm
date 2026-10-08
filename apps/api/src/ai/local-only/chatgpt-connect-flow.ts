import { ForbiddenException } from '@nestjs/common'
import { AiCategorizationMode } from '@wimm/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { type createAuthorizeRequest } from './chatgpt-authorize'
import {
  ChatGptSignInDeniedError,
  type startCallbackListener,
} from './chatgpt-callback-listener'
import type {
  ChatGptConnectionStatus,
  ChatGptConnectionStore,
} from './chatgpt-connection.store'
import type { OidcConfig } from './chatgpt-oidc'
import { type exchangeCode } from './chatgpt-token-exchange'

/**
 * Opens `url` in the user's own browser and returns once it has been handed
 * over -- not once the user is finished with it.
 *
 * **Never an embedded browser.** The authorization server's own page, in the
 * user's own browser, with the user's own session and extensions, is the
 * whole point: an embedded webview would be a window WIMM controls asking
 * for someone's ChatGPT password.
 *
 * Declared here because this is the only consumer. Task 11 supplies the real
 * implementation (`shell.openExternal`) from the desktop main process, which
 * is why `apps/api` stays Electron-free: it names the capability, it does
 * not own one.
 */
export type OpenBrowser = (url: string) => Promise<void>

/**
 * Verify-then-refuse for the one option that previously escaped it.
 *
 * `AppLocalModule.forRoot` checks its session token and its encryption
 * secret at the single unbypassable point, for the reason
 * `assertUsableSessionToken` records: a misconfiguration caught at boot names
 * the problem, while one caught later becomes a request-time 500. `openBrowser`
 * was the only option not held to that, so a non-function became a `TypeError`
 * on the user's first sign-in attempt.
 *
 * `undefined` is still allowed and becomes `null`: a composition that supplies
 * no opener refuses a connect with a message. Task 11 was going to make that a
 * compose-time requirement and deliberately did not: 16 `forRoot` boots in
 * the API's own specs pass no opener because they test sources, session
 * tokens and route posture, so the guarantee is enforced at the production
 * composer (`local-api.ts`) and checked there instead.
 */
export function assertUsableOpenBrowser(
  value: unknown,
): OpenBrowser | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'function') {
    throw new Error(
      'AppLocalModule.forRoot: refusing to compose the local API with an openBrowser that is not a function.',
    )
  }
  return value as OpenBrowser
}

/**
 * DI token for `OpenBrowser`. A `Symbol`, like `SESSION_TOKEN` and
 * `AI_PROVIDERS`, so it cannot collide with another provider token -- and
 * because a bare function has no class token Nest could resolve it by.
 */
export const CHATGPT_OPEN_BROWSER = Symbol('CHATGPT_OPEN_BROWSER')

/** `agent_name_hint` on a first registration. */
const APP_NAME = 'WIMM'

export interface ChatGptConnectDeps {
  store: Pick<
    ChatGptConnectionStore,
    'loadClientId' | 'save' | 'clearTokens' | 'status'
  >
  /**
   * Only `user` is used, and only for `aiCategorizationMode` /
   * `aiApiKeyEncrypted` -- see the consent gate below. Narrowed so a spec can
   * hand over a real `LocalPrismaService` (or nothing else) without
   * implementing a client.
   */
  prisma: Pick<PrismaService, 'user'>
  /** Compatible with `discoverOidcConfig`, whose signature is `(fetchImpl?)`. */
  discover: (fetchImpl?: typeof fetch) => Promise<OidcConfig>
  startListener: typeof startCallbackListener
  createRequest: typeof createAuthorizeRequest
  exchange: typeof exchangeCode
  /**
   * `null` when the composition supplied none. `connect` then refuses before
   * it touches the network -- see there. This stays nullable on purpose: Task 11
   * enforces the opener at the production composer rather than at compose
   * time, because most `forRoot` boots in the API's specs have no business
   * carrying a browser.
   */
  openBrowser: OpenBrowser | null
  appName?: string
  /** Handed to the callback listener; it applies its own default. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * The one place the seven pieces of the ChatGPT plan-usage sign-in meet:
 * discovery, the durable client ID, the loopback listener, the authorize
 * request, the user's browser, the code exchange, and persistence.
 *
 * **The order in `connect` is load-bearing, and not for style reasons.**
 *
 * - The listener is bound *before* the authorize request is built, because
 *   `redirect_uri` has to name the port and the port does not exist until
 *   something is bound to it. (`createAuthorizeRequest` is also the only
 *   producer of `state`, which the listener needs, so folding the two into
 *   one call is a cycle neither side can enter --
 *   `chatgpt-callback-listener.ts` documents that from its side.)
 * - `awaitCallback` is armed *before* the browser is opened, because the
 *   browser may come back before this function next gets scheduled. The
 *   listener buffers a callback that arrives unarmed, so this is not a
 *   correctness cliff today -- but the arm is what judges `state`, and
 *   "open, then arm" is one refactor away from dropping a callback.
 * - `listener.close()` is in a `finally`, because a flow that throws between
 *   binding and the callback must not leave the port held for the rest of
 *   the process's life.
 *
 * **The consent gate is set here, and that is a decision, not a side
 * effect.** `ImportsService` gates every AI call on the user's
 * `aiCategorizationMode`, which defaults to `OFF`, so a user who connected
 * ChatGPT and never visited the AI settings would be silently skipped. That
 * gate cannot be taught about ChatGPT: `ImportsService` is reachable from
 * `app.module.ts`, which must never reach anything under `ai/local-only/`
 * (see `scripts/verify-ai-hosted-composition.ts`). So the decision lands on
 * this side of the boundary:
 *
 * - **connect** sets `OFF` to `BYOK` -- the user supplied their own
 *   credential, which is exactly what a ChatGPT connection is, and
 *   `AiProvider`'s own doc comment already records that `SERVER` and `BYOK`
 *   say *whose credential*, not *which vendor*. A mode that is already
 *   non-`OFF` is the user's existing choice and is left alone.
 * - **disconnect** returns it to `OFF` *only* when `aiApiKeyEncrypted` is
 *   also null. Holding an Anthropic key and a ChatGPT connection at once is
 *   allowed, and dropping one must not quietly switch AI off while the other
 *   credential is still there.
 *
 * Each is a single conditional write rather than a read-then-write, so a
 * concurrent settings change cannot be clobbered between the two steps.
 *
 * **No credential leaves this class.** `connect` and `disconnect` both
 * return `store.status()`, which is built from scratch and has no field a
 * token could sit in. The authorization code, the PKCE verifier and every
 * token stay inside the calls that need them and are never logged -- there
 * is deliberately no logger here at all.
 *
 * Takes one deps object rather than injectable parameters, the same shape as
 * `ChatGptRefreshService`: its collaborators are module functions and a
 * store that Nest cannot resolve by type, so `local-only-ai.module.ts`
 * builds it with a `useFactory`.
 */
export class ChatGptConnectFlow {
  constructor(private readonly deps: ChatGptConnectDeps) {}

  /**
   * Runs one interactive sign-in and returns the resulting status.
   *
   * Resolves only once the user has finished with the authorization server,
   * or rejects when they decline, when the listener times out, or when any
   * step fails.
   */
  async connect(userId: string): Promise<ChatGptConnectionStatus> {
    const openBrowser = this.deps.openBrowser
    // Checked before discovery, not after: without an opener this attempt
    // cannot be completed by anyone, so there is no reason to spend a
    // network round trip or hold a port to find that out.
    if (openBrowser === null) {
      throw new Error(
        'ChatGPT sign-in cannot start: this composition was given no way to open a browser.',
      )
    }

    const config = await this.deps.discover(this.deps.fetchImpl)
    // Reuse the durable per-installation client ID when there is one.
    // Dynamic registration issues it once; re-registering would invalidate
    // every previously stored identity, because it is the `id_token`
    // audience.
    const existingClientId =
      (await this.deps.store.loadClientId(userId)) ?? undefined

    const listener = await this.deps.startListener(
      this.deps.timeoutMs === undefined ? {} : { timeoutMs: this.deps.timeoutMs },
    )
    try {
      const request = this.deps.createRequest({
        config,
        redirectUri: listener.redirectUri,
        appName: this.deps.appName ?? APP_NAME,
        existingClientId,
      })
      // ARM BEFORE OPENING THE BROWSER. A fast callback must not arrive
      // unarmed.
      const pending = listener.awaitCallback(request.state)
      await openBrowser(request.url)
      const { code, clientId } = await pending

      const { accountLabel, ...credentials } = await this.deps.exchange({
        config,
        clientId,
        code,
        verifier: request.verifier,
        redirectUri: listener.redirectUri,
        nonce: request.nonce,
        fetchImpl: this.deps.fetchImpl,
      })
      await this.deps.store.save(userId, clientId, credentials, accountLabel)
      await this.grantConsent(userId)
      return await this.deps.store.status(userId)
    } catch (error) {
      // "You declined" is not "something failed". Everything else -- a
      // timeout, a malformed callback, a refused exchange -- keeps its own
      // message and its own 500.
      if (error instanceof ChatGptSignInDeniedError) {
        throw new ForbiddenException(
          'ChatGPT sign-in was declined, so nothing was connected.',
        )
      }
      throw error
    } finally {
      listener.close()
    }
  }

  /**
   * Drops every stored secret and returns the resulting status.
   *
   * `clientId` and the account label survive on purpose (see
   * `ChatGptConnectionStore.clearTokens`): the client ID is the `id_token`
   * audience and re-registering would invalidate every stored identity, and
   * the label lets the UI offer to reconnect the account the user had.
   */
  async disconnect(userId: string): Promise<ChatGptConnectionStatus> {
    await this.deps.store.clearTokens(userId)
    await this.releaseConsent(userId)
    return this.deps.store.status(userId)
  }

  /** `OFF` -> `BYOK`. Any other mode is the user's own choice; leave it. */
  private async grantConsent(userId: string): Promise<void> {
    await this.deps.prisma.user.updateMany({
      where: { id: userId, aiCategorizationMode: AiCategorizationMode.OFF },
      data: { aiCategorizationMode: AiCategorizationMode.BYOK },
    })
  }

  /** Back to `OFF`, but only while no Anthropic key remains. */
  /**
   * Gives back only the consent `grantConsent` took.
   *
   * Symmetric with it, and both conditions are load-bearing:
   *
   * - `aiCategorizationMode: BYOK` -- `grantConsent` is careful to touch only
   *   a mode of `OFF`, on the grounds that anything else is the user's own
   *   choice. Without the same condition here, disconnecting forced `OFF`
   *   over a deliberately chosen `SERVER`, and did so even when no ChatGPT
   *   connection had ever existed: any authenticated local caller could flip
   *   another setting through an endpoint that should have been a no-op.
   *   `SERVER` is user-settable through `PATCH /users/me`, and by schema
   *   design has a null `aiApiKeyEncrypted`, so the other guard never fired.
   * - `aiApiKeyEncrypted: null` -- a user may hold an Anthropic key *and* a
   *   ChatGPT connection. Disconnecting one must not switch AI off while the
   *   other credential is still there.
   */
  private async releaseConsent(userId: string): Promise<void> {
    await this.deps.prisma.user.updateMany({
      where: {
        id: userId,
        aiCategorizationMode: AiCategorizationMode.BYOK,
        aiApiKeyEncrypted: null,
      },
      data: { aiCategorizationMode: AiCategorizationMode.OFF },
    })
  }
}
