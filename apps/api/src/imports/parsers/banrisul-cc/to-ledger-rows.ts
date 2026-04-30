/**
 * Map Banrisul orchestration output to import pipeline ledger rows.
 */

import type { ParsedLedgerRow } from '../csv-parser'
import type { BanrisulStatementParseResult } from './parse-statement-text'

export function banrisulStatementToLedgerRows(
  result: BanrisulStatementParseResult,
): ParsedLedgerRow[] {
  return result.transactions.map((t) => ({
    occurredAt: t.transactionDate,
    signedAmount: -t.amount,
    description: t.merchantRaw.trim().slice(0, 512),
    ...(t.installmentCurrent != null && t.installmentTotal != null
      ? {
          installmentCurrent: t.installmentCurrent,
          installmentTotal: t.installmentTotal,
        }
      : {}),
  }))
}
