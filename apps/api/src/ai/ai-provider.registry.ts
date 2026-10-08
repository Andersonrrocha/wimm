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
 * This is the seam the real dispatch calls through: `AiCategorizerSelector`
 * (`ai-categorizer-selector.service.ts`) asks for a provider by id, and
 * `ImportsService` categorizes with whichever one comes back.
 *
 * **There is exactly one of these per composition, and that is load-bearing.**
 * `AiModule` provides it; `LocalOnlyAiModule` adds its own provider to *this*
 * instance on init (`register` below) rather than building a second registry
 * over a longer list. The reason is Nest's resolution rule: a token resolves
 * through the injecting module's own import list, and `ImportsModule` imports
 * `AiModule` -- so a second registry living in `LocalOnlyAiModule` would be
 * unreachable from the import path no matter what it held, and the local
 * provider would be registered, resolvable in its own module's spec, and
 * never used. Do not reintroduce a per-composition `AI_PROVIDERS` list.
 *
 * Duplicate ids are rejected, at construction and at `register` alike: two
 * providers silently registered under the same id would make `.get()` return
 * whichever one happened to be inserted last, and a composition root would
 * have no signal that it had done that by accident.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly byId = new Map<string, AiProvider>()

  constructor(@Inject(AI_PROVIDERS) providers: AiProvider[]) {
    for (const provider of providers) this.register(provider)
  }

  /**
   * Adds a provider after construction, for a composition that layers one
   * on (`LocalOnlyAiModule`). Same duplicate-id refusal as the constructor,
   * which is why both go through here: two providers under one id would make
   * `get` return whichever was inserted last, with no signal.
   */
  register(provider: AiProvider): void {
    if (this.byId.has(provider.id)) {
      throw new Error(
        `AiProviderRegistry: duplicate AI provider id "${provider.id}" -- ` +
          'each provider registered into AI_PROVIDERS must use a unique id.',
      )
    }
    this.byId.set(provider.id, provider)
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
