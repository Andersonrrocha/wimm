import { AiByokSource, AiCategorizationMode } from '@wimm/shared'
import {
  CHATGPT_SHARING_FAILURE_CODES,
  describeChatGptState,
  readChatGptFailure,
  readChatGptStatus,
} from './chatgpt-connection-state'

/**
 * `mode`, `declined` and `failed` are part of the input, not optional extras
 * -- see `describeChatGptState`'s own doc comment. They are `BYOK` (the one
 * mode under which the connection is what runs), false and false here so that
 * each test below varies exactly one thing.
 *
 * `hasAnthropicKey` is false, which makes the plan the only own credential:
 * one source is used without asking, so `byokSource` is not consulted and
 * this base is the healthy connection.
 */
const base = {
  connected: true,
  sharing: true,
  online: true,
  mode: AiCategorizationMode.BYOK,
  hasAnthropicKey: false,
  byokSource: null,
  declined: false,
  failed: false,
}

describe('describeChatGptState', () => {
  it('invites connection rather than reporting an error when never connected', () => {
    const state = describeChatGptState({ ...base, connected: false, sharing: false })
    expect(state.tone).toBe('invite')
    expect(state.messageKey).toBe('ai.chatgpt.notConnected')
  })

  it('says the plan does not include sharing, and that retrying will not help', () => {
    const state = describeChatGptState({ ...base, sharing: false })
    expect(state.messageKey).toBe('ai.chatgpt.sharingNotEnabled')
    expect(state.retryable).toBe(false)
  })

  it('keeps the app usable when offline', () => {
    const state = describeChatGptState({ ...base, online: false })
    expect(state.messageKey).toBe('ai.chatgpt.offline')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(true)
  })

  // The real API error codes, with the retryability the API itself defines.
  it.each([
    ['subscription_sharing_user_not_eligible', 'ai.chatgpt.notEligible', false],
    ['subscription_sharing_usage_limit_exceeded', 'ai.chatgpt.limitReached', false],
    ['subscription_sharing_usage_unavailable', 'ai.chatgpt.usageUnavailable', true],
    ['subscription_sharing_unsupported_capability', 'ai.chatgpt.unsupportedCapability', false],
    ['subscription_sharing_route_not_supported', 'ai.chatgpt.routeNotSupported', false],
    ['subscription_sharing_invalid_user', 'ai.chatgpt.invalidUser', false],
    ['subscription_sharing_user_unavailable', 'ai.chatgpt.userUnavailable', true],
  ])('maps %s to its own message', (errorCode, messageKey, retryable) => {
    const state = describeChatGptState({ ...base, errorCode })
    expect(state.messageKey).toBe(messageKey)
    expect(state.retryable).toBe(retryable)
  })

  it('reports a connection the user has switched AI off for, not a healthy one', () => {
    const state = describeChatGptState({ ...base, mode: AiCategorizationMode.OFF })
    expect(state.messageKey).toBe('ai.chatgpt.modeOff')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(false)
  })

  // Under SERVER the server's own Anthropic key answers, so a live, sharing,
  // online ChatGPT connection is idle -- the panel must not call it "in use".
  it('reports a connection the server key has taken over from, not a healthy one', () => {
    const state = describeChatGptState({ ...base, mode: AiCategorizationMode.SERVER })
    expect(state.messageKey).toBe('ai.chatgpt.modeServer')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(false)
  })

  // The state a failed first connect leaves behind: nothing connected, no 403
  // and no code, because no ChatGPT route sets one. Without `failed` this was
  // indistinguishable from never having clicked "Connect".
  it('reports a failed first connect as a failure, not as never having tried', () => {
    const state = describeChatGptState({
      ...base,
      connected: false,
      sharing: false,
      failed: true,
    })
    expect(state.messageKey).toBe('ai.chatgpt.unknownError')
    expect(state.messageKey).not.toBe('ai.chatgpt.notConnected')
    expect(state.tone).toBe('error')
  })

  it('reports a failed call on a live connection, not a healthy one', () => {
    const state = describeChatGptState({ ...base, failed: true })
    expect(state.messageKey).toBe('ai.chatgpt.unknownError')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
  })

  // `readChatGptFailure` sets `failed` on a 403 too, so the decline has to
  // keep winning over the generic failure it is also an instance of.
  it('keeps a decline as a decline even though the call also failed', () => {
    const state = describeChatGptState({
      ...base,
      connected: false,
      sharing: false,
      failed: true,
      declined: true,
    })
    expect(state.messageKey).toBe('ai.chatgpt.declined')
    expect(state.messageKey).not.toBe('ai.chatgpt.unknownError')
    expect(state.tone).toBe('invite')
  })

  // The real call site always sets `failed` alongside an `errorCode`, so the
  // generic failure must rank below every code's own message.
  it('keeps each error code its own message when the call also failed', () => {
    for (const errorCode of CHATGPT_SHARING_FAILURE_CODES) {
      expect(describeChatGptState({ ...base, failed: true, errorCode })).toEqual(
        describeChatGptState({ ...base, errorCode }),
      )
    }
  })

  it('does not let a stale failure outrank a mode that leaves the connection idle', () => {
    expect(
      describeChatGptState({ ...base, failed: true, mode: AiCategorizationMode.OFF })
        .messageKey,
    ).toBe('ai.chatgpt.modeOff')
    expect(
      describeChatGptState({ ...base, failed: true, mode: AiCategorizationMode.SERVER })
        .messageKey,
    ).toBe('ai.chatgpt.modeServer')
  })

  it('reports a declined sign-in as a decision, not as a failure', () => {
    const state = describeChatGptState({
      ...base,
      connected: false,
      sharing: false,
      declined: true,
    })
    expect(state.messageKey).toBe('ai.chatgpt.declined')
    expect(state.messageKey).not.toBe('ai.chatgpt.unknownError')
    expect(state.tone).toBe('invite')
  })

  it('gives every distinct cause a distinct message', () => {
    const inputs = [
      { ...base, connected: false, sharing: false },
      { ...base, connected: false, sharing: false, declined: true },
      { ...base, connected: false, sharing: false, failed: true },
      { ...base, mode: AiCategorizationMode.OFF },
      { ...base, mode: AiCategorizationMode.SERVER },
      { ...base, hasAnthropicKey: true },
      { ...base, hasAnthropicKey: true, byokSource: AiByokSource.ANTHROPIC_KEY },
      { ...base, sharing: false },
      { ...base, online: false },
      { ...base, errorCode: 'subscription_sharing_user_not_eligible' },
      { ...base, errorCode: 'subscription_sharing_usage_limit_exceeded' },
      { ...base, errorCode: 'subscription_sharing_usage_unavailable' },
      { ...base, errorCode: 'subscription_sharing_unsupported_capability' },
      { ...base, errorCode: 'subscription_sharing_route_not_supported' },
      { ...base, errorCode: 'subscription_sharing_invalid_user' },
      { ...base, errorCode: 'subscription_sharing_user_unavailable' },
    ]
    const keys = inputs.map((input) => describeChatGptState(input).messageKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('falls back to a generic message for an unknown error code', () => {
    const state = describeChatGptState({ ...base, errorCode: 'something_new_from_openai' })
    expect(state.messageKey).toBe('ai.chatgpt.unknownError')
    expect(state.retryable).toBe(true)
  })

  // Both own credentials available and nothing stored is the one state
  // `AiCategorizerSelector` answers with `needsChoice`: no provider at all,
  // so the panel must ask rather than report a connection in use.
  it('asks which credential to use when both are available and none is chosen', () => {
    const state = describeChatGptState({ ...base, hasAnthropicKey: true })
    expect(state.messageKey).toBe('ai.chatgpt.chooseSource')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(false)
  })

  // The selector routes to the Anthropic key here, so this live connection is
  // idle -- the same over-claim `modeServer` exists to prevent.
  it('reports a connection the Anthropic key was chosen over, not a healthy one', () => {
    const state = describeChatGptState({
      ...base,
      hasAnthropicKey: true,
      byokSource: AiByokSource.ANTHROPIC_KEY,
    })
    expect(state.messageKey).toBe('ai.chatgpt.sourceAnthropicKey')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(false)
  })

  it('reports a healthy connection when the plan is the chosen source', () => {
    expect(
      describeChatGptState({
        ...base,
        hasAnthropicKey: true,
        byokSource: AiByokSource.CHATGPT_PLAN,
      }).messageKey,
    ).toBe('ai.chatgpt.connected')
  })

  // The selector ignores a stored source when only one credential exists,
  // including when it names the one the user does not have. A stale
  // `ANTHROPIC_KEY` on a user who removed their key must not call the plan
  // idle when the plan is exactly what runs.
  it('ignores a stored source naming a credential the user no longer has', () => {
    expect(
      describeChatGptState({ ...base, byokSource: AiByokSource.ANTHROPIC_KEY })
        .messageKey,
    ).toBe('ai.chatgpt.connected')
  })

  // Same ranking the mode branches get, for the same reason: with no choice
  // stored nothing runs, so an error in hand is from the past and `offline`'s
  // "suggestions resume on their own" is a promise nothing will keep.
  it('does not let a stale failure or an offline moment outrank a pending choice', () => {
    expect(
      describeChatGptState({ ...base, hasAnthropicKey: true, failed: true })
        .messageKey,
    ).toBe('ai.chatgpt.chooseSource')
    expect(
      describeChatGptState({ ...base, hasAnthropicKey: true, online: false })
        .messageKey,
    ).toBe('ai.chatgpt.chooseSource')
    expect(
      describeChatGptState({ ...base, hasAnthropicKey: true, sharing: false })
        .messageKey,
    ).toBe('ai.chatgpt.chooseSource')
  })

  it('reports a healthy connection', () => {
    expect(describeChatGptState(base).messageKey).toBe('ai.chatgpt.connected')
  })

  it('exports every sharing failure code it maps, for the locale guard', () => {
    expect(CHATGPT_SHARING_FAILURE_CODES).toHaveLength(7)
    for (const code of CHATGPT_SHARING_FAILURE_CODES) {
      expect(describeChatGptState({ ...base, errorCode: code }).messageKey).not.toBe(
        'ai.chatgpt.unknownError',
      )
    }
  })
})

describe('readChatGptStatus', () => {
  it('reads the four fields the API actually returns', () => {
    expect(
      readChatGptStatus({
        connected: true,
        sharing: true,
        accountLabel: 'someone@example.com',
        expiresAt: '2026-10-09T11:22:33.000Z',
      }),
    ).toEqual({
      connected: true,
      sharing: true,
      accountLabel: 'someone@example.com',
      expiresAt: '2026-10-09T11:22:33.000Z',
    })
  })

  it('renders a connection with no account name rather than an empty label', () => {
    const status = readChatGptStatus({
      connected: true,
      sharing: true,
      accountLabel: null,
      expiresAt: null,
    })
    expect(status.accountLabel).toBeNull()
    expect(status.expiresAt).toBeNull()
    expect(status.connected).toBe(true)
  })

  it('treats a missing or unparseable payload as "not connected"', () => {
    expect(readChatGptStatus(undefined)).toEqual({
      connected: false,
      sharing: false,
      accountLabel: null,
      expiresAt: null,
    })
    expect(readChatGptStatus('nonsense').connected).toBe(false)
  })

  // The sentinel is deliberately a string that cannot occur in ordinary
  // payload text or error messages: a short one like 'at' or 'rt' is a
  // substring of real content and would fail against correct code.
  it('never carries a credential through to the component', () => {
    const sentinel = 'QQ_CREDENTIAL_SENTINEL_QQ'
    const status = readChatGptStatus({
      connected: true,
      sharing: true,
      accountLabel: 'someone@example.com',
      expiresAt: '2026-10-09T11:22:33.000Z',
      accessToken: sentinel,
      refreshToken: sentinel,
      idToken: sentinel,
      tokensEncrypted: sentinel,
    })
    expect(Object.keys(status).sort()).toEqual([
      'accountLabel',
      'connected',
      'expiresAt',
      'sharing',
    ])
    expect(JSON.stringify(status)).not.toContain(sentinel)
  })
})

describe('readChatGptFailure', () => {
  it('recognises a declined sign-in by the 403 the API answers it with', () => {
    expect(readChatGptFailure({ response: { status: 403, data: {} } })).toEqual({
      failed: true,
      declined: true,
      errorCode: undefined,
    })
  })

  it('does not call any other failure a decline, but still calls it a failure', () => {
    for (const error of [
      { response: { status: 500, data: {} } },
      new Error('network down'),
      null,
    ]) {
      const failure = readChatGptFailure(error)
      expect(failure.declined).toBe(false)
      expect(failure.failed).toBe(true)
    }
  })

  it('carries a code the API supplied, and nothing when it supplied none', () => {
    expect(
      readChatGptFailure({
        response: { status: 429, data: { code: 'subscription_sharing_usage_limit_exceeded' } },
      }).errorCode,
    ).toBe('subscription_sharing_usage_limit_exceeded')
    expect(readChatGptFailure({ response: { status: 500, data: { code: '' } } }).errorCode).toBe(
      undefined,
    )
    expect(readChatGptFailure(new Error('network down')).errorCode).toBe(undefined)
  })
})
