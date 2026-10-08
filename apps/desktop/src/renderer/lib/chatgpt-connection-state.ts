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

export type ChatGptTone = 'invite' | 'info' | 'error'

export interface ChatGptStateInput {
  connected: boolean
  sharing: boolean
  /** `navigator.onLine`, passed in rather than read here. */
  online: boolean
  /**
   * The user's `aiCategorizationMode` is `OFF`.
   *
   * A connection that is live and doing nothing is the one row the failure
   * table did not have, and the one a user is least able to diagnose:
   * `ImportsService` gates every AI call on the mode, so with it `OFF` no
   * suggestion ever appears while the connection still reads as connected.
   */
  modeOff: boolean
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
 * - `modeOff` before everything about the network or the API: with the mode
 *   `OFF` no request is being made, so any error code in hand is from the
 *   past and the live fact is that AI is switched off.
 * - `online` before `errorCode`: offline, the last code is an artefact of
 *   the dropped connection rather than something the API said.
 * - `errorCode` before `sharing`: the API's own code names the cause
 *   precisely, where "sharing is not enabled" only describes the symptom.
 */
export function describeChatGptState(
  input: ChatGptStateInput,
): ChatGptStateDescription {
  if (input.declined) {
    return { messageKey: 'ai.chatgpt.declined', tone: 'invite', retryable: false }
  }
  if (!input.connected) {
    return { messageKey: 'ai.chatgpt.notConnected', tone: 'invite', retryable: false }
  }
  if (input.modeOff) {
    return { messageKey: 'ai.chatgpt.modeOff', tone: 'info', retryable: false }
  }
  if (!input.online) {
    return { messageKey: 'ai.chatgpt.offline', tone: 'info', retryable: true }
  }
  if (input.errorCode) {
    const known = SHARING_FAILURES.get(input.errorCode)
    if (known !== undefined) {
      return { messageKey: known.messageKey, tone: 'error', retryable: known.retryable }
    }
    return { messageKey: 'ai.chatgpt.unknownError', tone: 'error', retryable: true }
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
  declined: boolean
  errorCode: string | undefined
}

/**
 * Reads a failed `connect` / `disconnect` call as the two inputs
 * `describeChatGptState` needs.
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
    declined: response?.status === 403,
    errorCode: nonEmptyString(data.code) ?? undefined,
  }
}
