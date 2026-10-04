import Anthropic from '@anthropic-ai/sdk'
import { Injectable, Logger } from '@nestjs/common'
import { AiKeyResolverService } from './ai-key-resolver.service'
import type { AiProvider } from './ai-provider.interface'
import {
  buildPrompt,
  mapSuggestions,
  type RawSuggestions,
} from './categorize-suggestions'
import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from './dto/categorize-batch.dto'

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4000

/**
 * The one prompt line that is specific to this transport: it names the tool
 * this request defines. The rest of the prompt is shared
 * (`categorize-suggestions.ts`).
 */
const SUBMIT_INSTRUCTION =
  'Submit one suggestion per transaction via the submit_categorizations tool.'

/**
 * Categorizes a batch of import rows by asking Claude to pick the best
 * matching candidate category. Uses the SDK's tool_use so the response is
 * structured JSON we can trust without parsing free-form text. The prompt
 * and the validation of what comes back are shared with the other provider
 * (`categorize-suggestions.ts`); only the tool_use transport is this class's.
 *
 * Privacy contract: the only payload sent to Anthropic is `{description,
 * amount}` per row plus the candidate category names. Source names, account
 * identifiers, and user identity never leave the server.
 *
 * Failure mode: callers wrap in try/catch — anything thrown here means the
 * row stays unmatched, no badge in the UI, no error to the user.
 *
 * Credential: this provider resolves its own Anthropic key, per call, through
 * `AiKeyResolverService` -- `categorizeBatch` takes a `userId`, not a key (see
 * `AiProvider`). When the user has no usable key (AI off, BYOK without a
 * stored key, SERVER without `ANTHROPIC_API_KEY`, or a key that no longer
 * decrypts) it returns `[]` without building a client or touching the
 * network, the same "no key means skip AI" the resolver already applies
 * instead of throwing.
 *
 * `id` is a plain constant nothing reads except `AiProviderRegistry`
 * (`ai-provider.registry.ts`).
 */
@Injectable()
export class AnthropicCategorizerService implements AiProvider {
  private readonly logger = new Logger(AnthropicCategorizerService.name)

  readonly id = 'anthropic' as const

  constructor(private readonly keys: AiKeyResolverService) {}

  async categorizeBatch(args: {
    userId: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]> {
    if (args.transactions.length === 0 || args.candidates.length === 0) {
      return []
    }

    const apiKey = await this.keys.resolveForUser(args.userId)
    if (!apiKey) return []

    const client = new Anthropic({ apiKey })

    const prompt = buildPrompt(
      args.transactions,
      args.candidates,
      SUBMIT_INSTRUCTION,
    )

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [
        {
          name: 'submit_categorizations',
          description:
            'Submit categorization suggestions for the input transactions.',
          input_schema: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: {
                      type: 'integer',
                      description: 'The transaction index from the input list.',
                    },
                    categoryId: {
                      type: ['string', 'null'],
                      description:
                        'Best matching category id from the candidate list, or null when no candidate fits with reasonable confidence.',
                    },
                    confidence: {
                      type: 'number',
                      description:
                        'Confidence score from 0 (uncertain) to 1 (certain).',
                    },
                  },
                  required: ['index', 'categoryId', 'confidence'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_categorizations' },
      messages: [{ role: 'user', content: prompt }],
    })

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      this.logger.warn('Anthropic response had no tool_use block')
      return []
    }

    return mapSuggestions(toolUse.input as RawSuggestions, args.candidates)
  }
}
