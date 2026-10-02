import { Module } from '@nestjs/common'
import { ChatGptOauthProviderStub } from './chatgpt-oauth-provider.stub'

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
 * Deliberately not wired into `AI_PROVIDERS` (`ai-provider.registry.ts`):
 * there is no real plan-usage provider yet to design that merge against
 * (see `AiProviderRegistry`'s doc comment). This module's whole job today is
 * being a local-only file the exclusion check can prove the hosted root
 * cannot reach, while the local root demonstrably can.
 */
@Module({
  providers: [ChatGptOauthProviderStub],
  exports: [ChatGptOauthProviderStub],
})
export class LocalOnlyAiModule {}
