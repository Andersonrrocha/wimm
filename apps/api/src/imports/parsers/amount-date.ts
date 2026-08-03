import { BadRequestException } from '@nestjs/common'

/**
 * Which character is the decimal separator. Stating one disables the
 * last-separator heuristic entirely -- the caller's word is final, even for
 * an input the heuristic would have read the other way.
 */
export type DecimalSeparator = '.' | ','

export interface AmountFormat {
  /**
   * Omit to keep today's heuristic: whichever of `.`/`,` appears later in
   * the string is read as the decimal separator, the other as a thousands
   * separator. That heuristic cannot distinguish `1.234` (a Brazilian
   * thousand-and-a-quarter, i.e. 1234) from `1.234` (an American one point
   * two three four) -- both are legal, single-separator strings with
   * opposite readings. State the separator when the source is known (the
   * generic CSV mapper always will) instead of guessing.
   */
  decimalSeparator?: DecimalSeparator
}

/**
 * Which field comes first in a two-part, separator-delimited date such as
 * `03/04/2026`. Stating one disables the day-first default entirely.
 */
export type DateOrder = 'DMY' | 'MDY' | 'YMD'

export interface DateFormat {
  /**
   * Omit to keep today's heuristic: a separator-delimited date (`03/04/2026`)
   * is read day-first, and a compact 8-digit date (`20260403`) is read
   * year-first when the first four digits are a plausible year, day-first
   * otherwise. An unambiguous ISO date (`2026-04-03`) is always read
   * year-first regardless of this option, because it is never ambiguous.
   * State the order when the source is known instead of guessing --
   * `03/04/2026` is 3 April under the default and 4 March under `'MDY'`,
   * with no error either way.
   */
  order?: DateOrder
}

export function parseFlexibleAmount(raw: string, format?: AmountFormat): number {
  let t = raw.trim().replace(/\s/g, '')
  if (t === '' || t === '-') {
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }

  // Currency symbols are never part of the numeric value itself, and can
  // appear on either side of the sign (`R$ 1.234,56`, `-$123.45`, `$-123.45`).
  t = t.replace(/R\$|\$/g, '')

  // Parenthesised negative, e.g. "(123.45)" -- ordinary in statements.
  let isNeg = false
  const parenMatch = /^\((.*)\)$/.exec(t)
  if (parenMatch) {
    isNeg = !isNeg
    t = parenMatch[1]
  }

  if (t.startsWith('+')) {
    // `toCents` (packages/shared) rejects a leading '+' as malformed; amount
    // parsing agrees rather than disagreeing about what a valid amount looks
    // like, since nothing in this codebase emits a leading '+' either.
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }

  // Trailing minus, e.g. "123,45-": some exports place the sign after the
  // number for a debit. Treated as negative -- silently dropping it would
  // record a debit as a credit.
  if (t.length > 1 && t.endsWith('-')) {
    isNeg = !isNeg
    t = t.slice(0, -1)
  }

  if (t.startsWith('-')) {
    isNeg = !isNeg
    t = t.slice(1)
  }

  const body = t
  if (body === '') {
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }

  let normalized: string
  if (format?.decimalSeparator) {
    const decimal = format.decimalSeparator
    const thousands = decimal === ',' ? '.' : ','
    normalized = body.split(thousands).join('').replace(decimal, '.')
  } else {
    const lastComma = body.lastIndexOf(',')
    const lastDot = body.lastIndexOf('.')
    if (lastComma > lastDot) {
      normalized = body.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = body.replace(/,/g, '')
    }
  }

  const n = Number.parseFloat(normalized)
  if (Number.isNaN(n)) {
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }
  return isNeg ? -n : n
}

function utcNoon(y: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex, day, 12, 0, 0))
}

export function parseFlexibleDate(raw: string, format?: DateFormat): Date {
  const s = raw.trim()
  if (!s) throw new BadRequestException('Empty date')

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const y = Number.parseInt(iso[1], 10)
    const mo = Number.parseInt(iso[2], 10) - 1
    const d = Number.parseInt(iso[3], 10)
    if (mo < 0 || mo > 11 || d < 1 || d > 31) {
      throw new BadRequestException(`Invalid date: "${raw}"`)
    }
    return utcNoon(y, mo, d)
  }

  const br = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s)
  if (br) {
    const first = Number.parseInt(br[1], 10)
    const second = Number.parseInt(br[2], 10)
    let year = Number.parseInt(br[3], 10)
    if (year < 100) year += 2000

    // Default (and 'DMY'): day-first, matching today's behaviour for every
    // existing caller. 'MDY': month-first, for a stated American source.
    const day = format?.order === 'MDY' ? second : first
    const month = (format?.order === 'MDY' ? first : second) - 1

    if (month < 0 || month > 11 || day < 1 || day > 31) {
      throw new BadRequestException(`Invalid date: "${raw}"`)
    }
    return utcNoon(year, month, day)
  }

  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) {
    if (format?.order) {
      let y: number
      let mo: number
      let d: number
      if (format.order === 'YMD') {
        y = Number.parseInt(digits.slice(0, 4), 10)
        mo = Number.parseInt(digits.slice(4, 6), 10) - 1
        d = Number.parseInt(digits.slice(6, 8), 10)
      } else if (format.order === 'MDY') {
        mo = Number.parseInt(digits.slice(0, 2), 10) - 1
        d = Number.parseInt(digits.slice(2, 4), 10)
        y = Number.parseInt(digits.slice(4, 8), 10)
      } else {
        d = Number.parseInt(digits.slice(0, 2), 10)
        mo = Number.parseInt(digits.slice(2, 4), 10) - 1
        y = Number.parseInt(digits.slice(4, 8), 10)
      }
      if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) {
        throw new BadRequestException(`Invalid date: "${raw}"`)
      }
      return utcNoon(y, mo, d)
    }

    const yFirst = Number.parseInt(digits.slice(0, 4), 10)
    if (yFirst >= 1900 && yFirst <= 2100) {
      const mo = Number.parseInt(digits.slice(4, 6), 10) - 1
      const d = Number.parseInt(digits.slice(6, 8), 10)
      if (mo < 0 || mo > 11 || d < 1 || d > 31) {
        throw new BadRequestException(`Invalid date: "${raw}"`)
      }
      return utcNoon(yFirst, mo, d)
    }
    const d = Number.parseInt(digits.slice(0, 2), 10)
    const mo = Number.parseInt(digits.slice(2, 4), 10) - 1
    const y = Number.parseInt(digits.slice(4, 8), 10)
    if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) {
      throw new BadRequestException(`Unrecognized date format: "${raw}"`)
    }
    return utcNoon(y, mo, d)
  }

  const ms = Date.parse(s)
  if (!Number.isNaN(ms)) {
    return new Date(ms)
  }

  throw new BadRequestException(`Unrecognized date format: "${raw}"`)
}
