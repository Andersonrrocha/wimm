import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from './dto/categorize-batch.dto'

/**
 * The contract every AI categorization backend implements.
 *
 * Shaped directly around what `AnthropicCategorizerService.categorizeBatch`
 * already did before this contract existed -- see that class's own doc
 * comment -- rather than a speculative abstraction invented ahead of a
 * second real implementation. `AiKeyResolverService.resolveForUser` already
 * reduces both AI modes (`SERVER`, `BYOK`) down to a single opaque
 * credential string before a provider is ever called, so `apiKey` here is
 * deliberately generic: for Anthropic it is an Anthropic API key; for a
 * hosted, OAuth-backed provider it would be an OAuth access token. Neither
 * this interface nor anything that calls through it needs to know which --
 * that is the whole point of the seam.
 *
 * `id` is a stable, lowercase, kebab-case identifier used purely for
 * registration/selection (`AiProviderRegistry`, `ai-provider.registry.ts`).
 * It is never shown to a user and never persisted -- `AiCategorizationMode`
 * (`@wimm/shared`) is the persisted, user-facing concept (`OFF` / `SERVER` /
 * `BYOK`), and stays that way; adding a second provider does not require
 * adding a third value there, since both `SERVER` and `BYOK` already mean
 * "use whichever provider this composition wires up", not "use Anthropic
 * specifically".
 */
export interface AiProvider {
  readonly id: string

  categorizeBatch(args: {
    apiKey: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]>
}
