import { AI_PROVIDERS, AiProviderRegistry } from './ai-provider.registry'
import type { AiProvider } from './ai-provider.interface'

function fakeProvider(id: string): AiProvider {
  return {
    id,
    hasCredentialFor: jest.fn().mockResolvedValue(false),
    categorizeBatch: jest.fn().mockResolvedValue([]),
  }
}

describe('AiProviderRegistry', () => {
  it('resolves a registered provider by id', () => {
    const anthropic = fakeProvider('anthropic')
    const registry = new AiProviderRegistry([anthropic])

    expect(registry.get('anthropic')).toBe(anthropic)
    expect(registry.has('anthropic')).toBe(true)
  })

  it('returns undefined for an id nothing registered', () => {
    const registry = new AiProviderRegistry([fakeProvider('anthropic')])

    expect(registry.get('chatgpt-oauth')).toBeUndefined()
    expect(registry.has('chatgpt-oauth')).toBe(false)
  })

  it('resolves each provider independently when several are registered', () => {
    const anthropic = fakeProvider('anthropic')
    const other = fakeProvider('some-other-provider')
    const registry = new AiProviderRegistry([anthropic, other])

    expect(registry.get('anthropic')).toBe(anthropic)
    expect(registry.get('some-other-provider')).toBe(other)
  })

  it('refuses two providers registered under the same id', () => {
    const first = fakeProvider('anthropic')
    const second = fakeProvider('anthropic')

    expect(() => new AiProviderRegistry([first, second])).toThrow(/duplicate AI provider id "anthropic"/)
  })

  describe('register (a composition layering a provider on after construction)', () => {
    it('makes the added provider resolvable by its id', () => {
      const registry = new AiProviderRegistry([fakeProvider('anthropic')])
      const chatgpt = fakeProvider('chatgpt-oauth')

      registry.register(chatgpt)

      expect(registry.get('chatgpt-oauth')).toBe(chatgpt)
      expect(registry.has('chatgpt-oauth')).toBe(true)
    })

    it('leaves the constructed providers in place', () => {
      const anthropic = fakeProvider('anthropic')
      const registry = new AiProviderRegistry([anthropic])

      registry.register(fakeProvider('chatgpt-oauth'))

      expect(registry.get('anthropic')).toBe(anthropic)
    })

    // Same refusal as the constructor, because both go through `register`.
    // Without it, `get` would answer with whichever provider was inserted
    // last and the composition that did it would get no signal at all.
    it('refuses an id a constructed provider already holds, keeping the original', () => {
      const anthropic = fakeProvider('anthropic')
      const registry = new AiProviderRegistry([anthropic])
      const impostor = fakeProvider('anthropic')

      expect(() => registry.register(impostor)).toThrow(
        /duplicate AI provider id "anthropic"/,
      )
      expect(registry.get('anthropic')).toBe(anthropic)
    })

    it('refuses an id a previous register call already added', () => {
      const registry = new AiProviderRegistry([])
      registry.register(fakeProvider('chatgpt-oauth'))

      expect(() => registry.register(fakeProvider('chatgpt-oauth'))).toThrow(
        /duplicate AI provider id "chatgpt-oauth"/,
      )
    })
  })

  it('exposes AI_PROVIDERS as a stable symbol usable as a DI token', () => {
    expect(typeof AI_PROVIDERS).toBe('symbol')
  })
})
