import { Injectable } from '@nestjs/common'
import type { AiProvider } from '../ai-provider.interface'
import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from '../dto/categorize-batch.dto'

/**
 * Stand-in for the ChatGPT-plan-usage `AiProvider` implementation that does
 * not exist in this codebase yet.
 *
 * The seam it proves: an AI provider can belong to one composition root and
 * be unreachable from the other, enforced at build level rather than with a
 * runtime flag. The real provider -- OAuth against OpenAI, then the
 * Responses API drawing on the user's own ChatGPT Plus/Pro allowance -- is
 * future work. This class exists so the seam has something real to prove
 * itself against:
 *
 * - It is a genuine `AiProvider` implementation (not a mock, not a type-only
 *   fixture) -- proof the contract generalizes beyond Anthropic.
 * - It lives under `ai/local-only/`, the marker path
 *   `scripts/verify-ai-hosted-composition.ts` looks for. Nothing under that
 *   directory may be reachable from the hosted composition root
 *   (`app.module.ts`), because OpenAI licenses plan usage to open-source and
 *   locally-run projects while a remotely hosted app needs its waitlist.
 * - It is imported only by `LocalOnlyAiModule`, which in turn is imported
 *   only by `app.local.module.ts`. That import shape -- not a runtime flag --
 *   is what keeps it out of the hosted build's reachable graph.
 *
 * **Deliberately unimplemented.** `categorizeBatch` throws unconditionally.
 * No test may call it for real: this class exists to be *reachable or not*
 * from a given composition root, never to actually run. There is no OAuth
 * token to resolve, no HTTP client to configure, and no network call it
 * could make even if a test tried -- which is how it satisfies the
 * suite-wide "offline, no real AI API call" constraint by construction.
 *
 * Note for whoever writes the real provider: `categorizeBatch`'s current
 * signature takes an `apiKey`, inherited from the Anthropic BYOK path. Plan
 * usage has no API key -- it carries an OAuth access token instead, and the
 * open-source flow issues credentials without a client secret. Widening the
 * contract is part of that work, not of this stand-in.
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
