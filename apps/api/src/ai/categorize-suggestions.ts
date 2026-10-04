import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from './dto/categorize-batch.dto'

/**
 * What every provider shares about *what to ask* and *how far to trust the
 * answer*, kept apart from *how to ask it* (`AnthropicCategorizerService`
 * forces a `tool_use` call; `ChatGptOAuthProvider` asks the Responses API for
 * a JSON schema). The transport is provider-specific. The prompt and the
 * validation are not, and two copies would drift: the providers would then
 * disagree about what the same model output means.
 *
 * Lives here, in `ai/`, and not under `ai/local-only/`: the Anthropic provider
 * is reachable from the hosted root, so code it shares cannot sit behind the
 * local-only licensing boundary. `local-only/` importing from `ai/` is the
 * allowed direction.
 */

/**
 * A model answer below this confidence keeps its confidence but loses its
 * category: the row stays unmatched instead of showing a guess.
 */
export const MIN_CONFIDENCE = 0.6

/**
 * Builds the categorization prompt.
 *
 * `submitInstruction` is the one line that cannot be shared. It tells the
 * model how to hand its answer back, and each transport hands it back
 * differently: Anthropic's request defines a `submit_categorizations` tool, so
 * a sentence naming that tool is only meaningful there, and would reference
 * something that does not exist in a Responses API request. Everything else --
 * the instructions, the confidence guidance, the candidate list and the
 * transaction lines -- is common text.
 *
 * Privacy contract, unchanged by the move: a transaction contributes only
 * `{index, amount, description}`, and the candidates only `{id, name}`.
 */
export function buildPrompt(
  transactions: AiCategorizeInput[],
  candidates: AiCategorizeCandidate[],
  submitInstruction: string,
): string {
  const candidateLines = candidates
    .map((c) => `- ${c.id}: ${c.name}`)
    .join('\n')
  const txLines = transactions
    .map((t) => `${t.index}. amount=${t.amount} description="${t.description}"`)
    .join('\n')

  return [
    'You are a personal-finance assistant categorizing transactions for a user.',
    'For each transaction below, pick the single best-matching category from the candidate list, or return null if none fits well.',
    'Use the categoryId verbatim from the candidate list. Do not invent ids.',
    'Confidence should reflect how sure you are: 0.9+ for obvious matches, 0.6-0.8 for likely matches, below 0.6 (returns null) when guessing.',
    '',
    'Candidate categories (id: name):',
    candidateLines,
    '',
    'Transactions to categorize:',
    txLines,
    '',
    submitInstruction,
  ].join('\n')
}

/**
 * The shape both transports hand back, whatever carried it: an `input` object
 * on a `tool_use` block, or the parsed `output_text` of a structured response.
 * Fields are `unknown` because this is model output; `mapSuggestions` is what
 * decides which of it is believed.
 */
export interface RawSuggestions {
  suggestions?: Array<{
    index?: unknown
    categoryId?: unknown
    confidence?: unknown
  }>
}

/**
 * Turns what the model said into what the caller may use.
 *
 * This is the guard against a model inventing a category: a `categoryId` that
 * is not in the candidate list is dropped to `null` however confident the
 * model sounded, and so is anything under `MIN_CONFIDENCE`. The id is the
 * thing downstream code writes to a transaction, so it is never taken on the
 * model's word.
 *
 * - A suggestion whose `index` is not a number is discarded, since there is no
 *   row to attach it to.
 * - A missing or non-numeric `confidence` is 0, not "unknown, assume fine".
 * - A suggestion that fails either check still comes back, with a `null`
 *   `categoryId` and its confidence, so the caller sees the row was considered.
 */
export function mapSuggestions(
  input: RawSuggestions,
  candidates: AiCategorizeCandidate[],
): AiCategorizeResult[] {
  const candidateById = new Map(candidates.map((c) => [c.id, c]))

  const out: AiCategorizeResult[] = []
  for (const s of input.suggestions ?? []) {
    if (typeof s.index !== 'number') continue
    const confidence = typeof s.confidence === 'number' ? s.confidence : 0
    let categoryId: string | null = null
    if (
      typeof s.categoryId === 'string' &&
      candidateById.has(s.categoryId) &&
      confidence >= MIN_CONFIDENCE
    ) {
      categoryId = s.categoryId
    }
    out.push({ index: s.index, categoryId, confidence })
  }
  return out
}
