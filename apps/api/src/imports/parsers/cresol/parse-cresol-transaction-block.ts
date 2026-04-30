/**
 * Parse a single Cresol transaction block (from extractCresolTransactionBlocks) into a normalized row.
 * Not wired into ImportsService — composable building block.
 */

import type { CresolTransactionBlockCandidate } from './extract-cresol-transaction-blocks'
import { parseCresolAmountTail } from './parse-amount-tail'

export type CresolNormalizedTransaction = {
  occurredAt: Date
  signedAmount: number
  description: string
  rawBlock: string
  confidence: 'high' | 'low'
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function parseDdMmYyyyUtc(s: string): Date | null {
  const parts = s.trim().split('/')
  if (parts.length !== 3) return null
  const d = Number.parseInt(parts[0], 10)
  const m = Number.parseInt(parts[1], 10)
  const y = Number.parseInt(parts[2], 10)
  if (
    Number.isNaN(d) ||
    Number.isNaN(m) ||
    Number.isNaN(y) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return null
  }
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null
  }
  return dt
}

function normalizeLine(line: string): string {
  return line.replace(/\u00a0/g, ' ').replace(/[\u2013\u2014\u2212]/g, '-')
}

/**
 * Infer economic sign from Portuguese keywords (PIX DEBITO / CREDITO, SAQUE, etc.).
 * Returns null if no strong keyword match.
 */
function keywordIntentSign(blockText: string): 1 | -1 | null {
  const f = stripAccents(blockText).toUpperCase()
  if (/\bCREDITO\b/.test(f)) return 1
  if (/\bDEBITO\b/.test(f)) return -1
  if (/\bSAQUE\b/.test(f)) return -1
  if (/\bIOF\b/.test(f)) return -1
  if (/\bJUROS\b/.test(f)) return -1
  return null
}

type AmountFind = {
  lineIndex: number
  amount: number
  signFromAmount: 1 | -1
  descriptionPartOnAmountLine: string
}

function findAmountInBlock(rawLines: string[]): AmountFind | null {
  const lines = rawLines.map((l) => normalizeLine(l))
  for (let i = lines.length - 1; i >= 0; i--) {
    const tail = parseCresolAmountTail(lines[i])
    if (tail) {
      return {
        lineIndex: i,
        amount: tail.amount,
        signFromAmount: tail.sign,
        descriptionPartOnAmountLine: tail.descriptionPart,
      }
    }
  }
  return null
}

/**
 * Convert one transaction block to a normalized transaction.
 * Returns null if the date or amount cannot be parsed, or the description is empty.
 */
export function parseCresolTransactionBlock(
  block: CresolTransactionBlockCandidate,
): CresolNormalizedTransaction | null {
  const occurredAt = parseDdMmYyyyUtc(block.transactionDateRaw)
  if (!occurredAt) {
    return null
  }

  const found = findAmountInBlock(block.rawLines)
  if (!found) {
    return null
  }

  const lines = block.rawLines.map((l) => normalizeLine(l))
  const parts: string[] = []

  for (let i = 0; i < found.lineIndex; i++) {
    let s = lines[i].trim()
    if (i === 0) {
      s = s.replace(/^\d{2}\/\d{2}\/\d{4}\s+/, '').trim()
    }
    if (s) parts.push(s)
  }

  const tailDesc = found.descriptionPartOnAmountLine.trim()
  if (tailDesc) {
    parts.push(tailDesc)
  }

  let description = parts.join(' ').replace(/\s+/g, ' ').trim()
  description = description
    .replace(
      new RegExp(`^${block.transactionDateRaw.replace(/\//g, '\\/')}\\s*`),
      '',
    )
    .trim()
  if (!description) {
    return null
  }

  const intent = keywordIntentSign(block.rawBlock)
  let signedAmount: number
  let confidence: 'high' | 'low'

  if (intent !== null) {
    signedAmount = intent * found.amount
    confidence =
      intent === found.signFromAmount ? 'high' : 'low'
  } else {
    signedAmount = found.signFromAmount * found.amount
    confidence = 'high'
  }

  return {
    occurredAt,
    signedAmount,
    description: description.slice(0, 512),
    rawBlock: block.rawBlock,
    confidence,
  }
}
