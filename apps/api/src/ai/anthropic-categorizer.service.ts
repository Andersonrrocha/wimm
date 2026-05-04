import Anthropic from '@anthropic-ai/sdk'
import { Injectable, Logger } from '@nestjs/common'
import type {
  AiCategorizeCandidate,
  AiCategorizeInput,
  AiCategorizeResult,
} from './dto/categorize-batch.dto'

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4000
const MIN_CONFIDENCE = 0.6

/**
 * Categorizes a batch of import rows by asking Claude to pick the best
 * matching candidate category. Uses the SDK's tool_use so the response is
 * structured JSON we can trust without parsing free-form text.
 *
 * Privacy contract: the only payload sent to Anthropic is `{description,
 * amount}` per row plus the candidate category names. Source names, account
 * identifiers, and user identity never leave the server.
 *
 * Failure mode: callers wrap in try/catch — anything thrown here means the
 * row stays unmatched, no badge in the UI, no error to the user.
 */
@Injectable()
export class AnthropicCategorizerService {
  private readonly logger = new Logger(AnthropicCategorizerService.name)

  async categorizeBatch(args: {
    apiKey: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]> {
    if (args.transactions.length === 0 || args.candidates.length === 0) {
      return []
    }

    const client = new Anthropic({ apiKey: args.apiKey })

    const candidateById = new Map(args.candidates.map((c) => [c.id, c]))

    const prompt = buildPrompt(args.transactions, args.candidates)

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

    const input = toolUse.input as {
      suggestions?: Array<{
        index?: number
        categoryId?: string | null
        confidence?: number
      }>
    }

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
}

function buildPrompt(
  transactions: AiCategorizeInput[],
  candidates: AiCategorizeCandidate[],
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
    'Submit one suggestion per transaction via the submit_categorizations tool.',
  ].join('\n')
}
