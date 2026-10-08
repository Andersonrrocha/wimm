import {
  CHATGPT_SHARING_FAILURE_CODES,
  describeChatGptState,
  readChatGptFailure,
  readChatGptStatus,
} from './chatgpt-connection-state'

/**
 * `modeOff` and `declined` are part of the input, not optional extras -- see
 * `describeChatGptState`'s own doc comment. They are false here so that each
 * test below varies exactly one thing.
 */
const base = {
  connected: true,
  sharing: true,
  online: true,
  modeOff: false,
  declined: false,
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
    const state = describeChatGptState({ ...base, modeOff: true })
    expect(state.messageKey).toBe('ai.chatgpt.modeOff')
    expect(state.messageKey).not.toBe('ai.chatgpt.connected')
    expect(state.tone).toBe('info')
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
      { ...base, modeOff: true },
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
      declined: true,
      errorCode: undefined,
    })
  })

  it('does not call any other failure a decline', () => {
    expect(readChatGptFailure({ response: { status: 500, data: {} } }).declined).toBe(false)
    expect(readChatGptFailure(new Error('network down')).declined).toBe(false)
    expect(readChatGptFailure(null).declined).toBe(false)
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
