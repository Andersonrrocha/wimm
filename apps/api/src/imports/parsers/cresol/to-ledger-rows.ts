/**
 * Map Cresol parse output to import pipeline ledger rows.
 */

import type { ParsedLedgerRow } from '../csv-parser'
import type { CresolExtractedTextParseResult } from './parse-cresol-statement-extracted-text'

export function cresolStatementToLedgerRows(
  result: CresolExtractedTextParseResult,
): ParsedLedgerRow[] {
  return result.transactions.map((t) => ({
    occurredAt: t.occurredAt,
    signedAmount: t.signedAmount,
    description: t.description.trim().slice(0, 512),
  }))
}
