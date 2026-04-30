/**
 * Orchestrates Cresol statement parsing from full PDF-extracted text (no PDF bytes here).
 * Composable: layout guard → block extraction → per-block parse.
 *
 * Blocks start at a physical line beginning with `DD/MM/YYYY`. Continuation lines without a date
 * merge into the same movement; lines with the amount printed above the date are not supported.
 */

import { canParseCresolStatementPdf } from './cresol-layout-guard'
import { extractCresolTransactionBlocks } from './extract-cresol-transaction-blocks'
import { parseCresolTransactionBlock } from './parse-cresol-transaction-block'

export type CresolExtractedTextTransaction = {
  occurredAt: Date
  signedAmount: number
  description: string
  rawBlock: string
  confidence: 'high' | 'low'
}

export type CresolExtractedTextWarning = {
  code: string
  message: string
  rawBlock?: string
}

export type CresolExtractedTextParseResult = {
  transactions: CresolExtractedTextTransaction[]
  warnings: CresolExtractedTextWarning[]
}

/**
 * Parse a Cresol account statement from plain text (e.g. PDF text extraction output).
 *
 * - Returns `{ transactions: [], warnings: [unsupported_layout] }` if the text does not pass the layout guard.
 * - Per-block failures add `block_parse_failed` and do not stop other blocks.
 * - Adds `empty_result` when the layout is valid but no transactions were produced.
 * - Adds `low_confidence_block` when a row was parsed with `confidence: "low"`.
 */
export function parseCresolStatementFromExtractedText(
  text: string,
): CresolExtractedTextParseResult {
  const layout = canParseCresolStatementPdf(text)
  if (!layout.ok) {
    return {
      transactions: [],
      warnings: [
        {
          code: 'unsupported_layout',
          message: layout.message,
        },
      ],
    }
  }

  const blocks = extractCresolTransactionBlocks(text)
  const transactions: CresolExtractedTextTransaction[] = []
  const warnings: CresolExtractedTextWarning[] = []

  for (const block of blocks) {
    const parsed = parseCresolTransactionBlock(block)
    if (parsed) {
      transactions.push(parsed)
      if (parsed.confidence === 'low') {
        warnings.push({
          code: 'low_confidence_block',
          message:
            'Keyword-based debit/credit intent did not match the sign before R$ on the statement line',
          rawBlock: block.rawBlock,
        })
      }
    } else {
      warnings.push({
        code: 'block_parse_failed',
        message:
          'Could not parse this block (invalid date, missing amount, or empty description after cleanup)',
        rawBlock: block.rawBlock,
      })
    }
  }

  if (transactions.length === 0) {
    warnings.push({
      code: 'empty_result',
      message:
        'No transactions were parsed; check that lines start with DD/MM/YYYY and include signed BRL amounts',
    })
  }

  return { transactions, warnings }
}
