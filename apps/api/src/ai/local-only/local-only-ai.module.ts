import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiModule, buildAiProviders } from '../ai.module'
import { AI_PROVIDERS, AiProviderRegistry } from '../ai-provider.registry'
import { AnthropicCategorizerService } from '../anthropic-categorizer.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import { ChatGptOAuthProvider } from './chatgpt-oauth-provider'
import { discoverOidcConfig } from './chatgpt-oidc'
import { ChatGptRefreshService } from './chatgpt-refresh.service'
import { verifyIdentity } from './chatgpt-token-exchange'

/**
 * Local-only AI composition seam.
 *
 * Imported by the local composition root (`app.local.module.ts`) alone --
 * `app.module.ts` must never import this module or anything under
 * `ai/local-only/`.
 *
 * The reason is a licensing fact, not a preference. OpenAI offers "ChatGPT
 * plan usage" -- an end user spending their own Plus/Pro allowance inside a
 * third-party app -- to open-source projects and personal projects that run
 * locally; a paid or remotely hosted app must join a waitlist first. The
 * public desktop build is free, open-source and runs on the user's own
 * machine, so it is eligible. The owner's own VPS instance is the remotely
 * hosted case, so it is not. See
 * `scripts/verify-ai-hosted-composition.ts` for how that is enforced at
 * build level rather than with a runtime `if`, including the note that this
 * invariant pointed the other way until 2026-10-02.
 *
 * **What this module wires.** The real ChatGPT plan-usage provider
 * (`ChatGptOAuthProvider`) and what it stands on:
 *
 * - `ChatGptConnectionStore` takes its encryption secret as a plain string,
 *   which Nest cannot resolve by type, so it is built by a factory. The
 *   secret is read from `ConfigService` under `AI_KEY_ENCRYPTION_SECRET`:
 *   `AppLocalModule.forRoot` publishes the profile's secret into a global
 *   `ConfigService` under that key, which is the same seam `AiKeyCrypto`
 *   reads. No dynamic module and no injection token of its own is needed.
 * - `ChatGptRefreshService` and `ChatGptOAuthProvider` each take their
 *   collaborators as one object (so their specs need no DI container), so
 *   each is built by a factory too, supplied with the real store, OIDC
 *   discovery, `fetch` and identity verification.
 *
 * **The provider list.** `AI_PROVIDERS` is a module-private token:
 * `AiModule` builds its own list (the hosted one, `buildAiProviders`) and
 * hands out only the registry made from it, so nothing outside `AiModule`
 * can add to that list -- and `AiModule` must not import this module, since
 * it is reachable from the hosted root. This module therefore registers its
 * own `AI_PROVIDERS`: the hosted list plus `ChatGptOAuthProvider`, and an
 * `AiProviderRegistry` over it. That makes `'chatgpt-oauth'` resolvable here,
 * and a duplicate id a boot failure.
 *
 * That registry is deliberately not exported. `AiModule` exports one under
 * the same class token, so a module importing both would resolve whichever
 * came first. Nothing dispatches through either registry yet --
 * `ImportsService` still injects `AnthropicCategorizerService` directly -- so
 * how the merged one reaches a consumer is a decision for the change that
 * routes an import to this provider, not this one.
 */
@Module({
  imports: [AiModule],
  providers: [
    {
      provide: ChatGptConnectionStore,
      useFactory: (prisma: PrismaService, config: ConfigService) =>
        new ChatGptConnectionStore(
          prisma,
          config.getOrThrow<string>('AI_KEY_ENCRYPTION_SECRET'),
        ),
      inject: [PrismaService, ConfigService],
    },
    {
      provide: ChatGptRefreshService,
      useFactory: (store: ChatGptConnectionStore) =>
        new ChatGptRefreshService({
          store,
          discover: discoverOidcConfig,
          // Looked up per call rather than captured, so the global the
          // process actually has at that moment is the one used.
          fetchImpl: (input, init) => fetch(input, init),
          verifyIdentity,
        }),
      inject: [ChatGptConnectionStore],
    },
    {
      provide: ChatGptOAuthProvider,
      useFactory: (
        refresh: ChatGptRefreshService,
        store: ChatGptConnectionStore,
      ) =>
        new ChatGptOAuthProvider({
          refresh,
          store,
          fetchImpl: (input, init) => fetch(input, init),
        }),
      inject: [ChatGptRefreshService, ChatGptConnectionStore],
    },
    {
      provide: AI_PROVIDERS,
      useFactory: (
        anthropic: AnthropicCategorizerService,
        chatgpt: ChatGptOAuthProvider,
      ) => [...buildAiProviders(anthropic), chatgpt],
      inject: [AnthropicCategorizerService, ChatGptOAuthProvider],
    },
    AiProviderRegistry,
  ],
  exports: [ChatGptOAuthProvider],
})
export class LocalOnlyAiModule {}
