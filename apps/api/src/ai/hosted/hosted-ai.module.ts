import { Module } from '@nestjs/common'
import { ChatGptOauthProviderStub } from './chatgpt-oauth-provider.stub'

/**
 * Hosted-only AI composition seam.
 *
 * Imported by the hosted composition root (`app.module.ts`) alone --
 * `app.local.module.ts` must never import this module or anything under
 * `ai/hosted/`. This is the standing constraint from the owner (ChatGPT
 * OAuth stays only in the personally-hosted build, never the public one),
 * expressed as a composition choice rather than a runtime `if`. See
 * `chatgpt-oauth-provider.stub.ts`'s doc comment and
 * `scripts/verify-ai-local-composition.ts` for how that is checked at build
 * level, and the Stage 3 report (`.superpowers/sdd/stage-3-report.md`) for
 * what is proven now versus deferred until a real hosted-only provider
 * exists.
 *
 * Deliberately not wired into `AI_PROVIDERS` (`ai-provider.registry.ts`):
 * there is no real consumer yet to design that merge against (see
 * `AiProviderRegistry`'s doc comment) -- this module's whole job today is
 * being a hosted-only file the exclusion check can prove is unreachable
 * from the local root.
 */
@Module({
  providers: [ChatGptOauthProviderStub],
  exports: [ChatGptOauthProviderStub],
})
export class HostedAiModule {}
