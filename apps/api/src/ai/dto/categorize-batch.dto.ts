/**
 * Internal DTOs for the AI categorizer. Not exposed via HTTP — imports.service
 * is the only caller. The shape stays narrow on purpose: never sends source
 * names, account numbers, or anything beyond the description and amount.
 */

export interface AiCategorizeInput {
  /**
   * Stable index back into the imports preview rows. The categorizer returns
   * results keyed by the same index so callers can merge without alignment
   * bugs when some rows fail.
   */
  index: number
  description: string
  /** Decimal string already normalized to 2dp (e.g. "150.00"). */
  amount: string
}

export interface AiCategorizeCandidate {
  id: string
  /** Human-readable category name (leaf only). */
  name: string
}

export interface AiCategorizeResult {
  index: number
  /**
   * Suggested category id when the model is confident, otherwise null.
   * Backend already validated the id belongs to the user before returning.
   */
  categoryId: string | null
  /** 0..1 confidence reported by the model. */
  confidence: number
}
