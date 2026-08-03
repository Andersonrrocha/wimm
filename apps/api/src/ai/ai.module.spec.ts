import { AiProviderRegistry } from './ai-provider.registry'
import { AnthropicCategorizerService } from './anthropic-categorizer.service'
import { buildAiProviders } from './ai.module'

/**
 * Behavioral proof of `AiModule`'s own dispatch: the real Anthropic path,
 * selected by the real registry, under the real id -- not a mock standing
 * in for either. This is the test the Stage 3 mutation proof breaks on
 * purpose (see the Stage 3 report): mutate `buildAiProviders` to drop
 * Anthropic, register it under the wrong id, or return an empty array, and
 * "registers the Anthropic categorizer under id \"anthropic\"" below must
 * fail.
 */
describe('buildAiProviders (AiModule dispatch)', () => {
  it('registers the real Anthropic categorizer under id "anthropic"', () => {
    const anthropic = new AnthropicCategorizerService()

    const registry = new AiProviderRegistry(buildAiProviders(anthropic))

    expect(registry.get('anthropic')).toBe(anthropic)
  })

  it('does not register anything under a hosted-only id', () => {
    const anthropic = new AnthropicCategorizerService()

    const registry = new AiProviderRegistry(buildAiProviders(anthropic))

    expect(registry.get('chatgpt-oauth')).toBeUndefined()
  })
})
