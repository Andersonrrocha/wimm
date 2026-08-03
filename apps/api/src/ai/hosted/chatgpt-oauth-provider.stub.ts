import { Injectable } from '@nestjs/common'
import type { AiProvider } from '../ai-provider.interface'
import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from '../dto/categorize-batch.dto'

/**
 * Stand-in for the ChatGPT-OAuth-backed `AiProvider` implementation that
 * does not exist in this codebase yet.
 *
 * Stage 3 of the desktop completion program (see
 * `docs/superpowers/plans/2026-08-03-desktop-completion-program.md`) builds
 * the *seam* that lets a hosted-only AI provider exist without ever
 * compiling into the public/local build -- not the real OAuth provider
 * itself, which is future work the owner has not started. This class exists
 * solely so that seam has something real to prove itself against:
 *
 * - It is a genuine `AiProvider` implementation (not a mock, not a type-only
 *   fixture) -- proof the contract generalizes beyond Anthropic.
 * - It lives in its own file, under `ai/hosted/`, by convention the marker
 *   `scripts/verify-ai-local-composition.ts` looks for. Nothing under
 *   `ai/hosted/` may ever be reachable from the local composition root
 *   (`app.local.module.ts`) -- see that script's module doc comment.
 * - It is imported only by `HostedAiModule` (`hosted-ai.module.ts`), which
 *   in turn is imported only by the hosted composition root
 *   (`app.module.ts`). That import shape -- not a runtime flag -- is what
 *   keeps this file, and any real replacement for it, out of the public
 *   build's compiled output.
 *
 * **Deliberately unimplemented.** `categorizeBatch` throws unconditionally.
 * No test may call it for real: this class exists to be *reachable or not*
 * from a given composition root, never to actually run. There is no OAuth
 * token to resolve, no HTTP client to configure, and no network call this
 * class could make even if a test tried -- see the suite-wide "offline, no
 * real AI API call" constraint this satisfies by construction.
 */
@Injectable()
export class ChatGptOauthProviderStub implements AiProvider {
  readonly id = 'chatgpt-oauth' as const

  async categorizeBatch(_args: {
    apiKey: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]> {
    throw new Error(
      'ChatGptOauthProviderStub is a build-level stand-in for the Stage 3 exclusion proof -- ' +
        'it has no real implementation and must never be called.',
    )
  }
}
