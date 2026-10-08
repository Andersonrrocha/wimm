import { Module, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiModule } from '../ai.module'
import { AiProviderRegistry } from '../ai-provider.registry'
import { PrismaService } from '../../prisma/prisma.service'
import { createAuthorizeRequest } from './chatgpt-authorize'
import { startCallbackListener } from './chatgpt-callback-listener'
import {
  CHATGPT_OPEN_BROWSER,
  ChatGptConnectFlow,
  type OpenBrowser,
} from './chatgpt-connect-flow'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import { ChatGptController } from './chatgpt.controller'
import { ChatGptOAuthProvider } from './chatgpt-oauth-provider'
import { discoverOidcConfig } from './chatgpt-oidc'
import { ChatGptRefreshService } from './chatgpt-refresh.service'
import { exchangeCode, verifyIdentity } from './chatgpt-token-exchange'

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
 * - `ChatGptConnectFlow` is built the same way, and is the one provider here
 *   that needs something only the composition root can supply: a way to open
 *   the user's browser. It arrives under `CHATGPT_OPEN_BROWSER`, published
 *   **and exported** by `AppLocalModule.forRoot` from its `openBrowser`
 *   option -- `global: true` alone is not enough, as the comment there now
 *   records. The injection is **required**: optional injection turned a
 *   missing export into a silent runtime refusal that no test could see, so
 *   a composition that forgets it now fails at boot. A flow given a `null`
 *   opener still refuses at `connect`, before it
 *   touches the network, rather than failing to resolve at boot. Task 11
 *   turns that into a compose-time refusal.
 *
 * **How `'chatgpt-oauth'` becomes resolvable.** This module does NOT build a
 * provider list or a registry of its own. It injects the single
 * `AiProviderRegistry` that `AiModule` provides -- resolvable because of the
 * `imports: [AiModule]` below -- and registers `ChatGptOAuthProvider` into it
 * on init.
 *
 * It used to do the opposite: its own `AI_PROVIDERS` (the hosted list plus the
 * ChatGPT provider) and its own `AiProviderRegistry` over that, deliberately
 * unexported. That registry was unreachable from anything that could use it.
 * Nest resolves a token through the *injecting* module's own import list, and
 * `ImportsModule` imports `AiModule`; so the import path got `AiModule`'s
 * Anthropic-only registry even in the local composition, while a spec that
 * fetched this module's registry by hand saw `'chatgpt-oauth'` sitting in it
 * and passed. One registry removes that gap: there is no other instance for a
 * test to be accidentally right about.
 *
 * **Registration happens in `onModuleInit`, so it requires an initialized
 * application.** `Test.createTestingModule().compile()` constructs every
 * provider but runs no lifecycle hook, so a spec that needs the ChatGPT
 * provider to be in the registry must `init()` (what `app.init()` /
 * `app.listen()` do in production). A compile-only spec sees it absent.
 */
@Module({
  imports: [AiModule],
  controllers: [ChatGptController],
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
      provide: ChatGptConnectFlow,
      useFactory: (
        store: ChatGptConnectionStore,
        prisma: PrismaService,
        openBrowser: OpenBrowser | null | undefined,
      ) =>
        new ChatGptConnectFlow({
          store,
          prisma,
          discover: discoverOidcConfig,
          startListener: startCallbackListener,
          createRequest: createAuthorizeRequest,
          exchange: exchangeCode,
          // Absent when nothing published the token (see this module's doc
          // comment); `connect` refuses rather than guessing.
          openBrowser: openBrowser ?? null,
          fetchImpl: (input, init) => fetch(input, init),
        }),
      inject: [
        ChatGptConnectionStore,
        PrismaService,
        CHATGPT_OPEN_BROWSER,
      ],
    },
  ],
  exports: [ChatGptOAuthProvider],
})
export class LocalOnlyAiModule implements OnModuleInit {
  constructor(
    private readonly registry: AiProviderRegistry,
    private readonly chatgpt: ChatGptOAuthProvider,
  ) {}

  /**
   * Contributes this composition's extra provider into the registry
   * `AiModule` already exports -- the one the import path resolves. See this
   * module's doc comment for why there is no second registry to put it in.
   *
   * `register` refuses a duplicate id, so a composition that somehow imported
   * this module twice fails at boot instead of quietly keeping one of two
   * providers under `'chatgpt-oauth'`.
   */
  onModuleInit(): void {
    this.registry.register(this.chatgpt)
  }
}
