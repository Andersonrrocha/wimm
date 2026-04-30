/**
 * Banrisul credit card statement — single transaction line parser (text only).
 * Parses right-to-left: amount, optional trailing BR, optional installment NN/NN, merchant.
 */

export type BanrisulLineConfidence = 'high' | 'low'

export type BanrisulParsedLine = {
  date: string
  merchantRaw: string
  amount: number
  installmentCurrent?: number
  installmentTotal?: number
  /** Last NN/NN failed validation; line kept as non-installment. */
  invalidInstallmentIgnored?: boolean
  rawLine: string
  confidence: BanrisulLineConfidence
}

export type BanrisulLineParseResult =
  | { success: true; data: BanrisulParsedLine }
  | { success: false; warning: string; rawLine: string }

const LEADING_DATE = /^(\d{2}\/\d{2})\s+(.+)$/
const TRAILING_AMOUNT = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i
const TRAILING_BR = /\s+BR\s*$/i
const INSTALLMENT = /(\d{1,2})\/(\d{1,2})/g

function parseBrazilianAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (!t || !/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(t)) return null
  const normalized = t.replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(normalized)
  if (Number.isNaN(n) || n < 0.01) return null
  return n
}

function isValidInstallment(current: number, total: number): boolean {
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(total) ||
    current < 1 ||
    total < 1 ||
    current > total ||
    total > 99 ||
    current > 48
  ) {
    return false
  }
  return true
}

function findInstallment(
  s: string,
):
  | { start: number; end: number; current: number; total: number }
  | null
  | 'invalid' {
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  INSTALLMENT.lastIndex = 0
  while ((m = INSTALLMENT.exec(s)) !== null) {
    last = m
  }
  if (!last) return null

  const current = Number.parseInt(last[1], 10)
  const total = Number.parseInt(last[2], 10)
  if (!isValidInstallment(current, total)) {
    return 'invalid'
  }

  return {
    start: last.index,
    end: last.index + last[0].length,
    current,
    total,
  }
}

export function parseBanrisulTransactionLine(line: string): BanrisulLineParseResult {
  const rawLine = line
  const trimmed = line.trim()
  if (!trimmed) {
    return { success: false, warning: 'empty_line', rawLine }
  }

  const head = LEADING_DATE.exec(trimmed)
  if (!head) {
    return { success: false, warning: 'missing_leading_date', rawLine }
  }

  const date = head[1]
  const day = Number.parseInt(date.slice(0, 2), 10)
  const month = Number.parseInt(date.slice(3, 5), 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { success: false, warning: 'invalid_date', rawLine }
  }

  let tail = head[2].trimEnd()

  const amountMatch = TRAILING_AMOUNT.exec(tail)
  if (!amountMatch) {
    return { success: false, warning: 'missing_amount', rawLine }
  }

  const amount = parseBrazilianAmount(amountMatch[1])
  if (amount === null) {
    return { success: false, warning: 'invalid_amount', rawLine }
  }

  tail = tail.slice(0, tail.length - amountMatch[0].length).trimEnd()

  const hadTrailingBr = TRAILING_BR.test(tail)
  if (hadTrailingBr) {
    tail = tail.replace(TRAILING_BR, '').trimEnd()
  }

  const inst = findInstallment(tail)
  let merchantRaw: string
  let installmentCurrent: number | undefined
  let installmentTotal: number | undefined
  let invalidInstallmentIgnored = false

  if (inst === 'invalid') {
    invalidInstallmentIgnored = true
    merchantRaw = tail.trim()
  } else if (inst) {
    merchantRaw = tail.slice(0, inst.start).trim()
    installmentCurrent = inst.current
    installmentTotal = inst.total
  } else {
    merchantRaw = tail.trim()
  }

  if (!merchantRaw) {
    return { success: false, warning: 'missing_merchant', rawLine }
  }

  const confidence: BanrisulLineConfidence = hadTrailingBr ? 'high' : 'low'

  return {
    success: true,
    data: {
      date,
      merchantRaw,
      amount,
      installmentCurrent,
      installmentTotal,
      ...(invalidInstallmentIgnored
        ? { invalidInstallmentIgnored: true }
        : {}),
      rawLine,
      confidence,
    },
  }
}
