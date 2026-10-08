/**
 * What the ChatGPT plan-usage connection should tell the user, as pure
 * functions over plain data.
 *
 * Lives here rather than inside the component on purpose. `jest.config.js`
 * reaches `src/main` and `src/renderer/lib` with `testEnvironment: 'node'`
 * and `**\/*.spec.ts`; component-level testing (jsdom, React Testing
 * Library) is recorded there as future scope, and would mean two new
 * top-level dependencies. So every decision this feature makes is in this
 * file, where the existing harness already covers it, and
 * `components/settings/chatgpt-connection.tsx` is a thin renderer of the
 * result.
 */

import type { AiByokSource, AiCategorizationMode } from '@wimm/shared'

export type ChatGptTone = 'invite' | 'info' | 'error'

export interface ChatGptStateInput {
  connected: boolean
  sharing: boolean
  /** `navigator.onLine`, passed in rather than read here. */
  online: boolean
  /**
   * The user's `aiCategorizationMode`. Only `BYOK` means this connection is
   * the credential that runs.
   *
   * A connection that is live and doing nothing is the one row the failure
   * table did not have, and the one a user is least able to diagnose, and
   * there are two ways to get there. `ImportsService` gates every AI call on
   * the mode, so with it `OFF` no suggestion ever appears; with it `SERVER`
   * the server's own Anthropic key answers instead
   * (`AiKeyResolverService.resolveForUser`). Either way the connection still
   * reads as connected unless the mode is looked at, which is why this is
   * the mode itself and not a boolean: one field, three values, and no
   * combination of two flags that cannot occur.
   */
  mode: AiCategorizationMode
  /**
   * An Anthropic key is stored for this user (`User.hasAiApiKey`).
   *
   * With the connection live, that is the second own-credential source, and
   * it is the only condition under which `byokSource` means anything at all:
   * `AiCategorizerSelector` asks each provider whether it has a credential
   * and consults the stored choice only to break a genuine tie.
   */
  hasAnthropicKey: boolean
  /**
   * The user's `aiByokSource` -- which own credential they picked, or `null`
   * for "not chosen".
   *
   * Read only when `hasAnthropicKey` is true, exactly as the selector reads
   * it. With one source there is no tie to break, so the selector ignores
   * the stored value entirely, including when it names the source the user
   * does not have; a stale `ANTHROPIC_KEY` left on someone who has since
   * removed their key must not make this panel call the live plan idle.
   */
  byokSource: AiByokSource | null
  /**
   * The user refused consent at the authorization server.
   *
   * `ChatGptConnectFlow` answers that with a 403 and a message of its own,
   * and orders the `state` check before the `error` check specifically so a
   * local forgery cannot mislabel an attempt as a refusal. "You declined" is
   * not "something went wrong", and reporting it as a failure would throw
   * that distinction away.
   */
  declined: boolean
  /**
   * The last `connect` / `disconnect` call failed, for any reason.
   *
   * True for every rejection, so it is also true alongside `declined` and
   * alongside `errorCode`; the order of checks in `describeChatGptState`
   * is what lets those two keep their own, more precise, messages.
   *
   * Without it, a failure with no `declined` and no `errorCode` -- a
   * timeout, a malformed callback, a refused token exchange, i.e. every real
   * failure today, since no ChatGPT route sets `data.code` -- carried the
   * same inputs as "nothing has happened yet", and a first connect that
   * failed looked exactly like one never attempted.
   */
  failed: boolean
  /** A `subscription_sharing_*` code, when the API supplied one. */
  errorCode?: string
}

export interface ChatGptStateDescription {
  /** An i18next key under `ai.chatgpt.*`. */
  messageKey: string
  /**
   * Whether repeating the same operation could succeed -- the API's own
   * judgement for the `subscription_sharing_*` codes (mirrors
   * `SHARING_FAILURES` in `apps/api/src/ai/local-only/chatgpt-oauth-provider.ts`).
   *
   * False for every `invite` state: there the primary action is "Connect",
   * not "Retry", and offering both would be two buttons for one thing.
   *
   * It does not by itself put a "Try again" button on screen.
   * `shouldOfferRetry` is the question the UI actually asks, and it ignores
   * this flag entirely while nothing is connected. So `offlineCannotConnect`
   * carries `retryable: true` -- repeating that connect genuinely could
   * succeed -- and still renders no second button, because with no
   * connection "Connect" already *is* the retry. This flag is observable
   * only on a live connection; for every `!connected` state it describes the
   * operation without controlling the UI.
   */
  retryable: boolean
  tone: ChatGptTone
}

/**
 * One message per cause, because each cause has a different remedy.
 *
 * Collapsing these would tell a user who reached their own usage limit the
 * same thing as one whose workspace cannot use plan sharing at all -- the
 * conflation the API-side table is explicit about avoiding, and that
 * `chatgpt-connection-state.spec.ts` pins with a distinct-message assertion.
 *
 * A `Map`, not an object literal: the code comes off the wire, and
 * `table['constructor']` on a plain object finds `Object`'s own property.
 */
const SHARING_FAILURES = new Map<string, { messageKey: string; retryable: boolean }>([
  [
    'subscription_sharing_user_not_eligible',
    { messageKey: 'ai.chatgpt.notEligible', retryable: false },
  ],
  [
    'subscription_sharing_usage_limit_exceeded',
    { messageKey: 'ai.chatgpt.limitReached', retryable: false },
  ],
  [
    'subscription_sharing_usage_unavailable',
    { messageKey: 'ai.chatgpt.usageUnavailable', retryable: true },
  ],
  [
    'subscription_sharing_unsupported_capability',
    { messageKey: 'ai.chatgpt.unsupportedCapability', retryable: false },
  ],
  [
    'subscription_sharing_route_not_supported',
    { messageKey: 'ai.chatgpt.routeNotSupported', retryable: false },
  ],
  [
    'subscription_sharing_invalid_user',
    { messageKey: 'ai.chatgpt.invalidUser', retryable: false },
  ],
  [
    'subscription_sharing_user_unavailable',
    { messageKey: 'ai.chatgpt.userUnavailable', retryable: true },
  ],
])

/** Exported so `locale-parity.spec.ts` can check every message is translated. */
export const CHATGPT_SHARING_FAILURE_CODES: readonly string[] = [
  ...SHARING_FAILURES.keys(),
]

/**
 * What a failed call says: the API's own `subscription_sharing_*` code when
 * it supplied a known one, the generic message otherwise.
 */
function describeFailure(errorCode: string | undefined): ChatGptStateDescription {
  const known = errorCode === undefined ? undefined : SHARING_FAILURES.get(errorCode)
  if (known !== undefined) {
    return { messageKey: known.messageKey, tone: 'error', retryable: known.retryable }
  }
  return { messageKey: 'ai.chatgpt.unknownError', tone: 'error', retryable: true }
}

/**
 * The single message the connection UI should show, and whether to offer a
 * retry.
 *
 * **The order of the checks is the design.**
 *
 * - `declined` first: a refusal also leaves the connection absent, so the
 *   "not connected" invite would otherwise swallow the one state the API
 *   went to trouble to make distinguishable.
 * - `connected` before `sharing`: with no connection at all there is nothing
 *   to say about the plan, and `sharing` is false in that case anyway.
 * - `failed` is consulted inside the `connected` check, not after it: a
 *   connect that failed also leaves the connection absent, so it has the
 *   problem `declined` has. "Not connected" is exactly what the panel said
 *   before the click, and a user who tried and failed must not be told the
 *   same thing as one who never tried. Nothing below applies to an absent
 *   connection (there is no mode to be idle in, no network call to blame, no
 *   plan to describe), so a failed call needs no further ranking there.
 * - `mode` (`OFF` or `SERVER`) before everything about the network or the
 *   API: when the connection is not the credential that runs, no request is
 *   being made through it, so any error in hand is from the past and the
 *   live fact is that the connection is idle.
 * - `chooseSource` -- both own credentials available and neither stored --
 *   immediately after `mode`, and still ahead of everything about the
 *   network or the API, because it is the same kind of fact as `OFF` and
 *   `SERVER`: `AiCategorizerSelector` answers `needsChoice` and suggests
 *   nothing at all, so no request goes through this connection. Below
 *   `online` it would promise that "suggestions resume on their own", which
 *   with nothing chosen they never do; below `sharing` it would answer "is
 *   my plan doing anything?" with "it never can" and leave unsaid that the
 *   Anthropic key is idle too while no choice is stored. That last reason
 *   belongs to this branch alone -- see the next bullet, which must not be
 *   read as covered by it.
 * - `sourceAnthropicKey` -- the Anthropic key is the stored choice -- the
 *   other way round: *below* `online`, below `errorCode`/`failed`, and
 *   below `sharing`. Its message ends in "Set it to this plan to use it",
 *   and with `sharing` false that advice is simply wrong: switching the
 *   choice to the plan yields `sharingNotEnabled`, not a working plan, so
 *   `sharingNotEnabled` is both truer and more useful there. The argument
 *   that keeps `chooseSource` above `sharing` does not transfer, because
 *   here the Anthropic key is not idle -- it is the credential that runs --
 *   so reporting the plan's own defect leaves nothing unsaid. Below
 *   `online` it is harmless for the same reason: with the key doing the
 *   work, `offline`'s "suggestions resume on their own once the connection
 *   is back" is true.
 * - `byokSource` read only under `hasAnthropicKey` in both of those
 *   branches, which is the selector's own rule: one source is used without
 *   asking, so with no second source there is nothing pending and nothing
 *   the stored value can redirect. `CHATGPT_PLAN` falls through on purpose
 *   -- the plan is then what runs, and the branches below are the ones that
 *   describe the call it makes.
 * - `online` before `errorCode`: offline, the last code is an artefact of
 *   the dropped connection rather than something the API said.
 * - `errorCode` before `sharing`: the API's own code names the cause
 *   precisely, where "sharing is not enabled" only describes the symptom.
 * - `failed` with no code, after `errorCode` and before `sharing`: it is
 *   the same fact as `errorCode` minus the cause, and the plan flag cannot
 *   explain a call that just failed. It must not be checked before
 *   `errorCode`: `failed` is true for every rejection, a coded one included,
 *   so ahead of it every `subscription_sharing_*` message would be shadowed
 *   by the generic one.
 * - `!online` *inside* the `!connected` check and ahead of the failure it is
 *   also an instance of: a connect that failed with no network never reached
 *   ChatGPT, so `unknownError` -- "refused the request for a reason WIMM does
 *   not recognise" -- reports a refusal that never happened. The `offline`
 *   branch further down is equally wrong there, because "suggestions resume
 *   on their own" describes a connection that exists. It needs `failed`
 *   alongside it: offline and never attempted is still the plain invite, and
 *   this message is about an attempt.
 */
export function describeChatGptState(
  input: ChatGptStateInput,
): ChatGptStateDescription {
  if (input.declined) {
    return { messageKey: 'ai.chatgpt.declined', tone: 'invite', retryable: false }
  }
  if (!input.connected) {
    if (input.failed && !input.online) {
      return {
        messageKey: 'ai.chatgpt.offlineCannotConnect',
        tone: 'error',
        retryable: true,
      }
    }
    return input.failed
      ? describeFailure(input.errorCode)
      : { messageKey: 'ai.chatgpt.notConnected', tone: 'invite', retryable: false }
  }
  if (input.mode === 'OFF') {
    return { messageKey: 'ai.chatgpt.modeOff', tone: 'info', retryable: false }
  }
  if (input.mode === 'SERVER') {
    return { messageKey: 'ai.chatgpt.modeServer', tone: 'info', retryable: false }
  }
  if (input.hasAnthropicKey && input.byokSource === null) {
    return { messageKey: 'ai.chatgpt.chooseSource', tone: 'info', retryable: false }
  }
  if (!input.online) {
    return { messageKey: 'ai.chatgpt.offline', tone: 'info', retryable: true }
  }
  if (input.errorCode || input.failed) {
    return describeFailure(input.errorCode)
  }
  if (!input.sharing) {
    return { messageKey: 'ai.chatgpt.sharingNotEnabled', tone: 'error', retryable: false }
  }
  if (input.hasAnthropicKey && input.byokSource === 'ANTHROPIC_KEY') {
    return {
      messageKey: 'ai.chatgpt.sourceAnthropicKey',
      tone: 'info',
      retryable: false,
    }
  }
  return { messageKey: 'ai.chatgpt.connected', tone: 'info', retryable: false }
}

/**
 * Whether to offer a second, "Try again" button beside the panel's primary
 * action.
 *
 * `ChatGptStateDescription.retryable` is the mapping's judgement about the
 * *operation* and is right as it stands -- a failed connect could succeed on
 * a second try. Whether that deserves a second *button* is a different
 * question, and with nothing connected the answer is no: "Connect" is
 * already the retry, while "Try again" would only clear the message and
 * re-read a status that still says not-connected. A failed status call is
 * its own reason to offer the button regardless of the rest, since
 * re-checking is exactly what it needs.
 *
 * Here rather than inline in the component for the reason this whole module
 * exists: it is a pure boolean over three values, so the existing `node`
 * harness covers it, where the same expression written into JSX had no test
 * that could reach it.
 */
export function shouldOfferRetry(input: {
  /** `ChatGptStateDescription.retryable`. */
  retryable: boolean
  /** `ChatGptStatus.connected`. */
  connected: boolean
  /** `GET /api/ai/chatgpt/status` itself failed, so nothing is known. */
  statusFailed: boolean
}): boolean {
  return (input.retryable && input.connected) || input.statusFailed
}

/**
 * The whole of `GET /api/ai/chatgpt/status`, as the renderer sees it.
 *
 * `expiresAt` is a `string` and not a `Date`: the API returns
 * `ChatGptConnectionStatus`, whose `expiresAt` is a `Date`, and it crosses
 * the wire as JSON.
 */
export interface ChatGptStatus {
  connected: boolean
  sharing: boolean
  /** The verified `email` claim, or `null` -- render the connection without a name. */
  accountLabel: string | null
  /** ISO-8601, or `null`. */
  expiresAt: string | null
}

/**
 * Narrows the status response to exactly the four fields the UI uses.
 *
 * This is the renderer's own boundary against ever holding a credential.
 * `ChatGptConnectionStatus` has no field a token could sit in and
 * `chatgpt.controller.spec.ts` asserts that recursively over the real HTTP
 * bodies -- but that is a guarantee on the other side of the wire. Building
 * the object from named fields rather than spreading the payload means a
 * future API that grew a token field could not deliver one into React state
 * here, and the spec pins the key set.
 */
export function readChatGptStatus(payload: unknown): ChatGptStatus {
  const row = (payload ?? {}) as Record<string, unknown>
  return {
    connected: row.connected === true,
    sharing: row.sharing === true,
    accountLabel: nonEmptyString(row.accountLabel),
    expiresAt: nonEmptyString(row.expiresAt),
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export interface ChatGptFailure {
  /** The call failed. True for every rejection, including the 403. */
  failed: boolean
  declined: boolean
  errorCode: string | undefined
}

/**
 * Reads a failed `connect` / `disconnect` call as the three inputs
 * `describeChatGptState` needs.
 *
 * `failed` is unconditionally true: this is only ever called from an
 * `onError`, and it is what keeps a failure with no 403 and no code from
 * reading as "nothing has happened".
 *
 * `declined` is the 403: `ChatGptConnectFlow` raises `ForbiddenException`
 * for exactly one thing, a declined sign-in, and the only other 403 in the
 * API is `auth/register`'s `REGISTRATION_DISABLED`, which these routes
 * cannot reach. A timeout, a malformed callback and a refused exchange all
 * keep their own 500.
 */
export function readChatGptFailure(error: unknown): ChatGptFailure {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)
    ?.response
  const data = (response?.data ?? {}) as Record<string, unknown>
  return {
    failed: true,
    declined: response?.status === 403,
    errorCode: nonEmptyString(data.code) ?? undefined,
  }
}
