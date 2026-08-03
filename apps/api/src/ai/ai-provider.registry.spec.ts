import { AI_PROVIDERS, AiProviderRegistry } from './ai-provider.registry'
import type { AiProvider } from './ai-provider.interface'

function fakeProvider(id: string): AiProvider {
  return {
    id,
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

  it('exposes AI_PROVIDERS as a stable symbol usable as a DI token', () => {
    expect(typeof AI_PROVIDERS).toBe('symbol')
  })
})
