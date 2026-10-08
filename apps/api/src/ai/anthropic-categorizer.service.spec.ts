import type { AiKeyResolverService } from './ai-key-resolver.service'
import { AnthropicCategorizerService } from './anthropic-categorizer.service'

// Offline by construction: the SDK is replaced wholesale, so no test in this
// file can reach the network. `mock`-prefixed names are what lets the
// hoisted `jest.mock` factory below close over them.
const mockMessagesCreate = jest.fn()
const mockAnthropicConstructor = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: function MockAnthropic(options: { apiKey: string }) {
    mockAnthropicConstructor(options)
    return { messages: { create: mockMessagesCreate } }
  },
}))

/**
 * The provider owns its credential: `categorizeBatch` receives a `userId`
 * and resolves the Anthropic key itself, at call time. These specs pin that
 * behaviour -- who resolves, when, and what happens when there is no key --
 * because the timing is the reason the contract moved off a caller-supplied
 * `apiKey` in the first place.
 */
describe('AnthropicCategorizerService', () => {
  const resolveForUser = jest.fn<Promise<string | null>, [string]>()
  const keys = { resolveForUser } as unknown as AiKeyResolverService

  const transactions = [{ index: 0, description: 'Mercado Livre', amount: '123.45' }]
  const candidates = [{ id: 'cat-1', name: 'Groceries' }]

  const toolUseResponse = {
    content: [
      {
        type: 'tool_use',
        input: { suggestions: [{ index: 0, categoryId: 'cat-1', confidence: 0.9 }] },
      },
    ],
  }

  let service: AnthropicCategorizerService

  beforeEach(() => {
    jest.clearAllMocks()
    resolveForUser.mockResolvedValue('test-anthropic-key')
    mockMessagesCreate.mockResolvedValue(toolUseResponse)
    service = new AnthropicCategorizerService(keys)
  })

  it('resolves the credential for the requested user and builds its client with it', async () => {
    const out = await service.categorizeBatch({
      userId: 'user-1',
      transactions,
      candidates,
    })

    expect(resolveForUser).toHaveBeenCalledTimes(1)
    expect(resolveForUser).toHaveBeenCalledWith('user-1')
    expect(mockAnthropicConstructor).toHaveBeenCalledWith({
      apiKey: 'test-anthropic-key',
    })
    expect(out).toEqual([{ index: 0, categoryId: 'cat-1', confidence: 0.9 }])
  })

  it('returns [] without building a client or calling the API when the user has no usable key', async () => {
    resolveForUser.mockResolvedValue(null)

    const out = await service.categorizeBatch({
      userId: 'user-1',
      transactions,
      candidates,
    })

    expect(out).toEqual([])
    expect(mockAnthropicConstructor).not.toHaveBeenCalled()
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('resolves the credential on every call, so a credential rotated between batches is picked up', async () => {
    resolveForUser
      .mockResolvedValueOnce('first-test-key')
      .mockResolvedValueOnce('rotated-test-key')

    await service.categorizeBatch({ userId: 'user-1', transactions, candidates })
    await service.categorizeBatch({ userId: 'user-1', transactions, candidates })

    expect(resolveForUser).toHaveBeenCalledTimes(2)
    expect(mockAnthropicConstructor).toHaveBeenNthCalledWith(1, {
      apiKey: 'first-test-key',
    })
    expect(mockAnthropicConstructor).toHaveBeenNthCalledWith(2, {
      apiKey: 'rotated-test-key',
    })
  })

  it('does not look up a credential when there is nothing to categorize', async () => {
    const noTransactions = await service.categorizeBatch({
      userId: 'user-1',
      transactions: [],
      candidates,
    })
    const noCandidates = await service.categorizeBatch({
      userId: 'user-1',
      transactions,
      candidates: [],
    })

    expect(noTransactions).toEqual([])
    expect(noCandidates).toEqual([])
    expect(resolveForUser).not.toHaveBeenCalled()
    expect(mockAnthropicConstructor).not.toHaveBeenCalled()
  })

  describe('hasCredentialFor', () => {
    it('is true for a user whose key resolves', async () => {
      resolveForUser.mockResolvedValue('test-anthropic-key')

      expect(await service.hasCredentialFor('user-1')).toBe(true)
      expect(resolveForUser).toHaveBeenCalledWith('user-1')
    })

    it('is false for a user whose key does not resolve', async () => {
      resolveForUser.mockResolvedValue(null)

      expect(await service.hasCredentialFor('user-1')).toBe(false)
    })

    // `AiProvider.hasCredentialFor` is contractually cheap and
    // side-effect-free: selection calls it on every enabled preview, so it
    // must never build a client or reach the API.
    it('builds no client and calls the API not at all', async () => {
      await service.hasCredentialFor('user-1')

      expect(mockAnthropicConstructor).not.toHaveBeenCalled()
      expect(mockMessagesCreate).not.toHaveBeenCalled()
    })

    // The resolved key is a secret; the answer is one bit about it.
    it('returns a plain boolean, never the key it looked at', async () => {
      resolveForUser.mockResolvedValue('sk-ant-SENTINEL-must-not-escape')

      const answer = await service.hasCredentialFor('user-1')

      // `typeof` is the whole assertion: a mutation that returned the key
      // instead of a boolean fails here, and stringifying a boolean to search
      // it for the sentinel could never fail at all.
      expect(typeof answer).toBe('boolean')
    })
  })
})
