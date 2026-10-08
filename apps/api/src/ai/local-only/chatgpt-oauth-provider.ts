import { Logger } from '@nestjs/common'
import type { AiProvider } from '../ai-provider.interface'
import {
  buildPrompt,
  mapSuggestions,
  type RawSuggestions,
} from '../categorize-suggestions'
import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from '../dto/categorize-batch.dto'
import type { ChatGptConnectionStore } from './chatgpt-connection.store'
import {
  ChatGptRefreshRetryableError,
  type ChatGptRefreshService,
} from './chatgpt-refresh.service'

const RESPONSES_URL = 'https://api.openai.com/v1/responses'

/**
 * A single model id, not a setting. Plan usage draws on the user's own
 * allowance, so this is a small, cheap model on purpose -- the same trade the
 * Anthropic provider makes with Haiku. If plan sharing exposes a different set
 * of models, this is the one line that changes.
 */
const MODEL = 'gpt-5-mini'

/**
 * Twice the Anthropic provider's figure. The visible answer is the same size,
 * but a reasoning model spends part of this same budget thinking, and a cap hit
 * mid-answer leaves truncated JSON that cannot be parsed.
 */
const MAX_OUTPUT_TOKENS = 8000

/** Bounds the request, so a call that never settles cannot hold an import open. */
const REQUEST_TIMEOUT_MS = 60_000

/**
 * What the Responses API must return. `strict: true` requires every object to
 * list all its properties as `required` and to set `additionalProperties:
 * false`, which Anthropic's tool schema does not need. The *fields* are the
 * same as that provider's `submit_categorizations` input, so one result
 * validation (`mapSuggestions`) serves both.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'The transaction index from the input list.',
          },
          categoryId: {
            type: ['string', 'null'],
            description:
              'Best matching category id from the candidate list, or null when no candidate fits with reasonable confidence.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score from 0 (uncertain) to 1 (certain).',
          },
        },
        required: ['index', 'categoryId', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const

/**
 * The transport-specific prompt line. Anthropic's names its forced tool; there
 * is no tool here, the answer is the structured response itself.
 */
const SUBMIT_INSTRUCTION =
  'Return one suggestion per transaction in the structured response.'

/**
 * Why a ChatGPT request failed, in terms a caller can act on.
 *
 * `code` is the API's own error code when it sent one, `retryable` says
 * whether asking again later can help, and `status` is the HTTP status (or
 * `null` when no response arrived). **The message is always static**: it is
 * chosen from what `code` and `status` say, never copied from the response, so
 * nothing the server or the network stack said -- which could echo a request --
 * ends up in a log line. The original error, when there is one, is on `cause`.
 */
export class ChatGptRequestError extends Error {
  // `lib` stops at ES2021 here, so `ErrorOptions` is not available.
  readonly cause?: unknown
  readonly status: number | null
  readonly code: string | null
  readonly retryable: boolean

  constructor(
    message: string,
    details: {
      status: number | null
      code: string | null
      retryable: boolean
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'ChatGptRequestError'
    this.status = details.status
    this.code = details.code
    this.retryable = details.retryable
    // Non-enumerable, as a native `cause` is, so it stays out of
    // `JSON.stringify`, a spread, and any log line that serialises the object.
    Object.defineProperty(this, 'cause', {
      value: details.cause,
      enumerable: false,
      writable: false,
      configurable: true,
    })
  }
}

/**
 * The `subscription_sharing_*` codes ChatGPT plan sharing answers with, each
 * kept distinct because each has a different cause and a different remedy.
 * Collapsing them into "AI unavailable" would tell a user who reached their
 * own limit the same thing as one whose workspace cannot use sharing at all.
 *
 * A `Map`, not an object literal: the code comes off the wire, and
 * `table['constructor']` on a plain object finds `Object`'s own property.
 */
const SHARING_FAILURES = new Map<string, { message: string; retryable: boolean }>([
  [
    'subscription_sharing_user_not_eligible',
    {
      message:
        'This ChatGPT account or workspace cannot use plan sharing, so it cannot be used for categorization.',
      retryable: false,
    },
  ],
  [
    'subscription_sharing_usage_limit_exceeded',
    {
      message:
        "A ChatGPT plan-sharing limit was reached. These limits are the user's own usage and per-app limits in ChatGPT Settings; they can be raised there or wait for the reset.",
      retryable: false,
    },
  ],
  [
    'subscription_sharing_usage_unavailable',
    {
      message:
        'ChatGPT could not check plan usage just now. Trying again later may work.',
      retryable: true,
    },
  ],
  [
    'subscription_sharing_unsupported_capability',
    {
      message:
        'The categorization request used a capability that ChatGPT plan sharing does not support.',
      retryable: false,
    },
  ],
  [
    'subscription_sharing_route_not_supported',
    {
      message:
        'The categorization request used a route that ChatGPT plan sharing does not support.',
      retryable: false,
    },
  ],
  [
    'subscription_sharing_invalid_user',
    {
      message:
        'ChatGPT could not validate the subscription context for this account.',
      retryable: false,
    },
  ],
  [
    'subscription_sharing_user_unavailable',
    {
      message:
        'This ChatGPT account or workspace is temporarily unavailable. Trying again later may work.',
      retryable: true,
    },
  ],
])

/**
 * What the provider needs from the outside, as one object so a spec can
 * substitute each piece without a DI container (the same shape
 * `ChatGptRefreshService` uses).
 */
export interface ChatGptOAuthProviderDeps {
  /** Resolves, and refreshes when needed, the access token. */
  refresh: Pick<ChatGptRefreshService, 'accessTokenFor'>
  /**
   * Where `sharing` comes from. The refresh service does not report it; the
   * store's `status` does, and carries no credential.
   */
  store: Pick<ChatGptConnectionStore, 'status'>
  fetchImpl: typeof fetch
  /** Per-request timeout; defaults to 60 seconds. */
  timeoutMs?: number
}

/**
 * Categorizes a batch of import rows through the user's own ChatGPT plan, via
 * the Responses API ("plan usage").
 *
 * The prompt and the validation of the answer are `categorize-suggestions.ts`,
 * shared with the Anthropic provider; only the transport is this class's.
 *
 * **Never gates an import.** No connection, `sharing` off, a token that cannot
 * be had (`null`, or a retryable refresh failure) all return `[]` -- "no
 * suggestions this time" -- rather than throwing. A request the API refuses
 * does throw a `ChatGptRequestError`, which the caller already catches and
 * logs; that is a different thing from there being nothing to try.
 *
 * **`store: false`.** The request body holds transaction descriptions and
 * amounts. It tells OpenAI not to retain the request, which for a personal
 * finance app is a privacy property, not a performance option.
 *
 * **A 401 is retried at most once**, by asking the refresh service for a
 * token again -- and only when that returns a *different* token. The refresh
 * service decides expiry from the local clock, so when OpenAI's clock is
 * ahead of ours it returns the same string, and re-posting it would send the
 * transaction descriptions and amounts again for a provably identical 401.
 * `accessTokenFor` refreshing early covers request latency, and a resumed
 * rotation can hand back a token that has since expired; one retry closes
 * those. A second would be a loop.
 *
 * **No credential in a log, an error message or a result.** The token goes in
 * one header. Every error message here is static, and a failure of `fetch`
 * itself is wrapped rather than rethrown, since what a network stack says about
 * a failed request is not ours to vouch for.
 *
 * Local compositions only: this lives under `ai/local-only/`, which the hosted
 * root must never reach (see `scripts/verify-ai-hosted-composition.ts`).
 */
export class ChatGptOAuthProvider implements AiProvider {
  private readonly logger = new Logger(ChatGptOAuthProvider.name)

  readonly id = 'chatgpt-oauth' as const

  private readonly refresh: ChatGptOAuthProviderDeps['refresh']
  private readonly store: ChatGptOAuthProviderDeps['store']
  private readonly fetchImpl: typeof fetch

  constructor(deps: ChatGptOAuthProviderDeps) {
    this.refresh = deps.refresh
    this.store = deps.store
    const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.fetchImpl = (input, init) =>
      deps.fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }

  /**
   * Whether a connection exists that this provider could read, from the
   * store's own `status` -- one local, decrypt-and-discard read. No refresh,
   * no network call: the contract on `AiProvider.hasCredentialFor` says
   * selection must stay cheap, and asking the authorization server whether a
   * user *might* be offered a suggestion would spend a token rotation on a
   * question.
   *
   * `sharing` is deliberately NOT part of this. A connected plan that cannot
   * share is a failure at call time with its own message
   * (`SHARING_FAILURES` above, surfaced as `ai.chatgpt.sharingNotEnabled`),
   * not an absent credential -- folding it in here would make the settings
   * panel say "not connected" about an account that plainly is, and would
   * silently route a user to their other credential instead of telling them
   * what to fix in ChatGPT.
   *
   * `status` returns no secret and this returns a bare boolean, so nothing
   * about the credential escapes either way.
   */
  async hasCredentialFor(userId: string): Promise<boolean> {
    const status = await this.store.status(userId)
    return status.connected
  }

  async categorizeBatch(args: {
    userId: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]> {
    if (args.transactions.length === 0 || args.candidates.length === 0) {
      return []
    }

    // Checked before a token is asked for: with `sharing` off there is nothing
    // a refresh could help with, so none is made.
    const status = await this.store.status(args.userId)
    if (!status.connected || !status.sharing) return []

    const token = await this.accessToken(args.userId)
    if (token === null) return []

    const body = JSON.stringify({
      model: MODEL,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: buildPrompt(args.transactions, args.candidates, SUBMIT_INSTRUCTION),
      text: {
        format: {
          type: 'json_schema',
          name: 'submit_categorizations',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    })

    let response = await this.post(token, body)
    let code = response.ok ? null : await readErrorCode(response)

    // An error the API names tells us why; a fresh token does not change it.
    // Only an unexplained 401 is worth one more try.
    if (response.status === 401 && !isSharingCode(code)) {
      const retryToken = await this.accessToken(args.userId)
      if (retryToken === null) return []
      // Only re-send when the token actually changed. `accessTokenFor`
      // decides expiry from the LOCAL clock, so if OpenAI's clock is ahead
      // of ours it hands back the very same string -- and re-posting it
      // would transmit the user's transaction descriptions and amounts a
      // second time for a provably identical 401. For a personal-finance
      // app that second transmission is the part that matters, not the
      // wasted round trip.
      if (retryToken === token) {
        this.logger.warn(
          'ChatGPT rejected the access token and refreshing returned the same one; not retrying.',
        )
        throw failure(response.status, code)
      }
      response = await this.post(retryToken, body)
      code = response.ok ? null : await readErrorCode(response)
    }

    if (!response.ok) throw failure(response.status, code)

    let data: unknown
    try {
      data = await response.json()
    } catch {
      // `json()` on a malformed body quotes its first characters.
      throw new ChatGptRequestError('ChatGPT response could not be parsed.', {
        status: response.status,
        code: null,
        retryable: false,
      })
    }

    const text = outputText(data)
    if (text === null) {
      this.logger.warn('ChatGPT response had no output text')
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      this.logger.warn('ChatGPT output text was not valid JSON')
      return []
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.logger.warn('ChatGPT output text was not a JSON object')
      return []
    }

    return mapSuggestions(parsed as RawSuggestions, args.candidates)
  }

  /**
   * A usable access token, or `null` for "no suggestions this time".
   *
   * `null` from the refresh service means there is no connection that can
   * supply one. A `ChatGptRefreshRetryableError` means something transient
   * failed, and the connection is intact. Neither is a reason to fail an
   * import, so both end the same way. Anything else is not something this
   * method understands, and is left to propagate.
   */
  private async accessToken(userId: string): Promise<string | null> {
    try {
      return await this.refresh.accessTokenFor(userId)
    } catch (error) {
      if (error instanceof ChatGptRefreshRetryableError) return null
      throw error
    }
  }

  private async post(token: string, body: string): Promise<Response> {
    try {
      return await this.fetchImpl(RESPONSES_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        // `fetch` follows a 307/308 and re-sends the body, which here is the
        // user's transactions. Refuse instead of following.
        redirect: 'error',
        body,
      })
    } catch (cause) {
      throw new ChatGptRequestError('ChatGPT request could not reach the API.', {
        status: null,
        code: null,
        retryable: true,
        cause,
      })
    }
  }
}

function isSharingCode(code: string | null): code is string {
  return code !== null && SHARING_FAILURES.has(code)
}

/**
 * The error for a non-OK response, with a message chosen rather than copied.
 *
 * `code` is kept on the error only when it is one of the codes this file
 * knows. An unrecognised one is whatever the server chose to write, and it is
 * an enumerable property of an object that callers log; the same reasoning
 * keeps it out of the message.
 */
function failure(status: number, code: string | null): ChatGptRequestError {
  if (isSharingCode(code)) {
    const known = SHARING_FAILURES.get(code)!
    return new ChatGptRequestError(known.message, {
      status,
      code,
      retryable: known.retryable,
    })
  }
  if (status === 401) {
    return new ChatGptRequestError(
      'ChatGPT rejected the access token (status 401); ChatGPT may need to be reconnected.',
      { status, code: null, retryable: false },
    )
  }
  return new ChatGptRequestError(`ChatGPT request failed (status ${status}).`, {
    status,
    code: null,
    retryable: status === 429 || status >= 500,
  })
}

/**
 * The text the model produced.
 *
 * The REST response nests it under `output[].content[]`; `output_text` at the
 * top level is what the official SDKs add for convenience. Both are read, so
 * this does not depend on which one the endpoint returns.
 */
function outputText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as { output_text?: unknown; output?: unknown }
  if (typeof record.output_text === 'string') return record.output_text
  if (!Array.isArray(record.output)) return null

  const parts: string[] = []
  for (const item of record.output as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const message = item as { type?: unknown; content?: unknown }
    if (message.type !== 'message' || !Array.isArray(message.content)) continue
    for (const part of message.content as unknown[]) {
      if (typeof part !== 'object' || part === null) continue
      const piece = part as { type?: unknown; text?: unknown }
      // A refusal is a part of another type, with no `text` to read.
      if (piece.type === 'output_text' && typeof piece.text === 'string') {
        parts.push(piece.text)
      }
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

/**
 * The API's own error code from a non-OK body, or `null`. Two shapes, as the
 * refresh service reads them: `{ error: { code } }` and a bare `{ error }`
 * string. An unreadable body is not an error here, just "no code".
 */
async function readErrorCode(response: Response): Promise<string | null> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}
