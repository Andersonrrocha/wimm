/**
 * Banrisul credit card statement — orchestrate parsing from full extracted PDF text.
 * Does not read PDF bytes or integrate with ImportsService.
 */

import { extractBanrisulCardSections } from './section-extractor'
import {
  extractBanrisulStatementBillingSnapshot,
  extractBanrisulStatementDate,
} from './statement-date'
import { parseBanrisulTransactionLine } from './line-parser'
import { transactionDateFromDdMmAndYear } from './transaction-date'
import { validateBanrisulSectionTotals } from './section-total-validation'

export type BanrisulOrchestratedTransaction = {
  cardLast4: string
  transactionDate: Date
  merchantRaw: string
  amount: number
  installmentCurrent?: number
  installmentTotal?: number
  rawLine: string
  confidence: 'high' | 'low'
}

export type BanrisulOrchestratedWarning = {
  code: string
  message: string
  rawLine?: string
  cardLast4?: string
  /** Declared TOTAL DE GASTOS (section total validation). */
  expectedTotal?: number
  /** Sum of successfully parsed transaction amounts for the card. */
  actualTotal?: number
  /** actualTotal - expectedTotal (BRL), rounded to cents. */
  delta?: number
}

export type BanrisulStatementParseResult = {
  statementDate: Date
  /** Set when the PDF text includes a Vencimento line (for credit card import billing snapshot). */
  statementBilling?: {
    paymentDueDate: Date
    statementClosingDate?: Date
  }
  transactions: BanrisulOrchestratedTransaction[]
  warnings: BanrisulOrchestratedWarning[]
}

/**
 * Parse a Banrisul statement from plain text (e.g. PDF text extraction output).
 *
 * @throws If statement date cannot be found or no card sections exist under history.
 */
export function parseBanrisulStatementFromText(
  text: string,
): BanrisulStatementParseResult {
  const { statementDate } = extractBanrisulStatementDate(text)
  const statementBilling =
    extractBanrisulStatementBillingSnapshot(text) ?? undefined
  const year = statementDate.getUTCFullYear()

  const sections = extractBanrisulCardSections(text)
  if (sections.length === 0) {
    throw new Error(
      'Banrisul: no card sections found (missing history or card headers)',
    )
  }

  const transactions: BanrisulOrchestratedTransaction[] = []
  const warnings: BanrisulOrchestratedWarning[] = []

  for (const section of sections) {
    if (section.rawLines.length === 0) {
      warnings.push({
        code: 'empty_section',
        message: 'Card section has no transaction lines to parse',
        cardLast4: section.cardLast4,
      })
    }

    for (const rawLine of section.rawLines) {
      const parsed = parseBanrisulTransactionLine(rawLine)
      if (!parsed.success) {
        warnings.push({
          code: 'line_parse_failed',
          message: parsed.warning,
          rawLine: parsed.rawLine,
          cardLast4: section.cardLast4,
        })
        continue
      }

      let transactionDate: Date
      try {
        transactionDate = transactionDateFromDdMmAndYear(parsed.data.date, year)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        warnings.push({
          code: 'invalid_transaction_date',
          message: msg,
          rawLine: parsed.data.rawLine,
          cardLast4: section.cardLast4,
        })
        continue
      }

      transactions.push({
        cardLast4: section.cardLast4,
        transactionDate,
        merchantRaw: parsed.data.merchantRaw,
        amount: parsed.data.amount,
        installmentCurrent: parsed.data.installmentCurrent,
        installmentTotal: parsed.data.installmentTotal,
        rawLine: parsed.data.rawLine,
        confidence: parsed.data.confidence,
      })

      if (parsed.data.invalidInstallmentIgnored) {
        warnings.push({
          code: 'installment_ignored_invalid',
          message:
            'Installment pattern (NN/NN) failed validation and was ignored for this line',
          rawLine: parsed.data.rawLine,
          cardLast4: section.cardLast4,
        })
      }
    }
  }

  warnings.push(
    ...validateBanrisulSectionTotals(
      sections.map((s) => ({
        cardLast4: s.cardLast4,
        declaredTotal: s.declaredTotal,
      })),
      transactions,
    ),
  )

  return {
    statementDate,
    ...(statementBilling !== undefined ? { statementBilling } : {}),
    transactions,
    warnings,
  }
}
