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
 * second real implementation.
 *
 * A provider resolves its own credential. `categorizeBatch` therefore takes a
 * `userId` -- whose credential to resolve -- and not a pre-resolved secret.
 * Credential lifetime is provider-specific: an Anthropic API key is static,
 * but an OAuth access token can expire in the middle of a batch and has to be
 * refreshed in flight. A string handed in by the caller cannot express that,
 * because by the time the provider holds it, it is already a snapshot; only
 * the provider, owning the credential, can notice it has gone stale and
 * replace it. (`AiKeyResolverService.resolveForUser` is what the Anthropic
 * provider resolves through, collapsing both AI modes -- `SERVER`, `BYOK` --
 * to one key; it is an implementation detail of that provider, not part of
 * this contract.) A provider with no usable credential for the user returns
 * `[]` rather than throwing, matching how `AiKeyResolverService` already
 * treats a missing or undecryptable key as "no key".
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
    userId: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]>
}
