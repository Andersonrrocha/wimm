import { Module } from '@nestjs/common'
import { AI_PROVIDERS, AiProviderRegistry } from './ai-provider.registry'
import type { AiProvider } from './ai-provider.interface'
import { AiKeyCrypto } from './ai-key-crypto'
import { AiKeyResolverService } from './ai-key-resolver.service'
import { AnthropicCategorizerService } from './anthropic-categorizer.service'

/**
 * Builds this module's own `AI_PROVIDERS` registration -- the dispatch that
 * decides which concrete `AiProvider` answers to which `id` for this
 * composition. Today, exactly one: the Anthropic categorizer, under
 * `'anthropic'`.
 *
 * Exported (not inlined into the `@Module` decorator below) so it can be
 * unit-tested directly, without a Nest DI container -- see
 * `ai.module.spec.ts`, which is also this codebase's mutation-proof target
 * for "break the contract's dispatch": returning the wrong provider, the
 * wrong id, or an empty array here is exactly the kind of change that test
 * exists to catch.
 *
 * A hosted-only provider (`ai/hosted/hosted-ai.module.ts`) is deliberately
 * NOT added here -- see that module's doc comment for why merging it in is
 * deferred rather than designed against a stand-in.
 */
export function buildAiProviders(anthropic: AnthropicCategorizerService): AiProvider[] {
  return [anthropic]
}

@Module({
  providers: [
    AiKeyCrypto,
    AiKeyResolverService,
    AnthropicCategorizerService,
    {
      provide: AI_PROVIDERS,
      useFactory: buildAiProviders,
      inject: [AnthropicCategorizerService],
    },
    AiProviderRegistry,
  ],
  exports: [
    AiKeyCrypto,
    AiKeyResolverService,
    AnthropicCategorizerService,
    AiProviderRegistry,
  ],
})
export class AiModule {}
