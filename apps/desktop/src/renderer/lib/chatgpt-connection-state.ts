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

import type { AiCategorizationMode } from '@wimm/shared'

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
 */
export function describeChatGptState(
  input: ChatGptStateInput,
): ChatGptStateDescription {
  if (input.declined) {
    return { messageKey: 'ai.chatgpt.declined', tone: 'invite', retryable: false }
  }
  if (!input.connected) {
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
  if (!input.online) {
    return { messageKey: 'ai.chatgpt.offline', tone: 'info', retryable: true }
  }
  if (input.errorCode || input.failed) {
    return describeFailure(input.errorCode)
  }
  if (!input.sharing) {
    return { messageKey: 'ai.chatgpt.sharingNotEnabled', tone: 'error', retryable: false }
  }
  return { messageKey: 'ai.chatgpt.connected', tone: 'info', retryable: false }
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
