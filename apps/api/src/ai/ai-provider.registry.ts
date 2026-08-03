import { Inject, Injectable } from '@nestjs/common'
import type { AiProvider } from './ai-provider.interface'

/**
 * DI token for the array of `AiProvider` implementations a composition root
 * wires in. A plain `Symbol`, not a class: `AiProvider` is an interface, and
 * an interface leaves no runtime value for Nest to key a provider token on
 * (unlike `AiKeyResolverService`/`AnthropicCategorizerService`, which are
 * real classes and can be injected by themselves) -- this is the standard
 * Nest pattern for that case.
 */
export const AI_PROVIDERS = Symbol('AI_PROVIDERS')

/**
 * Resolves an `AiProvider` by its stable `id`.
 *
 * This is the seam a real dispatch -- picking which registered provider
 * answers a given request -- would call through. Nothing does yet:
 * `ImportsService` still injects `AnthropicCategorizerService` directly (see
 * `imports.service.ts`), unchanged from before this contract existed,
 * because today there is exactly one provider and routing a single-entry
 * lookup through a registry would be ceremony with no behavior difference --
 * and Task 3.1's own requirement is "no behaviour change". This registry
 * exists so that routing through `.get(id)` is a one-line change once a
 * second provider is real, not a redesign.
 *
 * Duplicate ids are rejected at construction: two providers silently
 * registered under the same id would make `.get()` return whichever one
 * happened to be inserted last, and a composition root would have no signal
 * that it had done that by accident.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly byId = new Map<string, AiProvider>()

  constructor(@Inject(AI_PROVIDERS) providers: AiProvider[]) {
    for (const provider of providers) {
      if (this.byId.has(provider.id)) {
        throw new Error(
          `AiProviderRegistry: duplicate AI provider id "${provider.id}" -- ` +
            'each provider registered into AI_PROVIDERS must use a unique id.',
        )
      }
      this.byId.set(provider.id, provider)
    }
  }

  /** The provider registered under `id`, or `undefined` if none is. */
  get(id: string): AiProvider | undefined {
    return this.byId.get(id)
  }

  /** Whether a provider is registered under `id`. */
  has(id: string): boolean {
    return this.byId.has(id)
  }
}
