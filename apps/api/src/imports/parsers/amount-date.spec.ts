import { toCents } from '@wimm/shared'
import { parseFlexibleAmount, parseFlexibleDate } from './amount-date'

/**
 * Money is integer cents in this project. Asserting a float return value
 * proves less than it appears to -- `toFixed(2)` plus `toCents` is the same
 * conversion the real import pipeline applies (see `imports.service.ts`),
 * so a passing assertion here means the value that would actually reach
 * domain code is correct to the cent.
 */
function cents(n: number): number {
  return toCents(n.toFixed(2))
}

describe('parseFlexibleAmount', () => {
  describe('heuristic (no format stated)', () => {
    it('reads a lone dot as decimal when it is the last separator', () => {
      expect(cents(parseFlexibleAmount('123.45'))).toBe(12345)
    })

    it('reads a lone comma as decimal when it is the last separator', () => {
      expect(cents(parseFlexibleAmount('123,45'))).toBe(12345)
    })

    it('reads dot-then-comma as thousands-dot, decimal-comma (pt-BR)', () => {
      expect(cents(parseFlexibleAmount('1.234,56'))).toBe(123456)
    })

    it('reads comma-then-dot as thousands-comma, decimal-dot (en-US)', () => {
      expect(cents(parseFlexibleAmount('1,234.56'))).toBe(123456)
    })

    it('parses zero', () => {
      expect(cents(parseFlexibleAmount('0.00'))).toBe(0)
      expect(cents(parseFlexibleAmount('0,00'))).toBe(0)
    })

    it('parses a leading minus as negative', () => {
      expect(cents(parseFlexibleAmount('-123.45'))).toBe(-12345)
    })

    it('parses a trailing minus as negative rather than silently dropping it', () => {
      // The live defect: a trailing-minus debit must not become a credit.
      expect(cents(parseFlexibleAmount('123,45-'))).toBe(-12345)
      expect(cents(parseFlexibleAmount('123.45-'))).toBe(-12345)
    })

    it('parses a parenthesised amount as negative', () => {
      expect(cents(parseFlexibleAmount('(123,45)'))).toBe(-12345)
      expect(cents(parseFlexibleAmount('(123.45)'))).toBe(-12345)
    })

    it('parses a currency symbol prefix', () => {
      expect(cents(parseFlexibleAmount('R$ 1.234,56'))).toBe(123456)
      expect(cents(parseFlexibleAmount('$1,234.56'))).toBe(123456)
    })

    it('parses a currency symbol combined with a negative notation', () => {
      expect(cents(parseFlexibleAmount('-R$ 123,45'))).toBe(-12345)
      expect(cents(parseFlexibleAmount('($123.45)'))).toBe(-12345)
    })

    it('rejects a leading plus, agreeing with toCents', () => {
      expect(() => parseFlexibleAmount('+123.45')).toThrow(
        'Invalid amount: "+123.45"',
      )
    })

    it('rejects empty and lone-sign input', () => {
      expect(() => parseFlexibleAmount('')).toThrow()
      expect(() => parseFlexibleAmount('-')).toThrow()
      expect(() => parseFlexibleAmount('()')).toThrow()
    })

    it('rejects unparsable text', () => {
      expect(() => parseFlexibleAmount('abc')).toThrow()
    })
  })

  describe('ambiguous inputs the heuristic cannot resolve safely', () => {
    it('reads a lone-dot amount as a Brazilian thousands separator when stated', () => {
      // Heuristic alone would read '1.234' as 1.234 -- a 1000x error for a
      // pt-BR bank where '.' groups thousands and there is no decimal part.
      expect(
        cents(parseFlexibleAmount('1.234', { decimalSeparator: ',' })),
      ).toBe(123400)
    })

    it('reads a lone-comma amount as an American thousands separator when stated', () => {
      // Heuristic alone would read '1,234' as 1.234 -- the same 1000x error,
      // opposite convention, for an en-US bank.
      expect(
        cents(parseFlexibleAmount('1,234', { decimalSeparator: '.' })),
      ).toBe(123400)
    })
  })
})

describe('parseFlexibleDate', () => {
  describe('heuristic (no format stated) -- unchanged for existing callers', () => {
    it('parses DD/MM/YYYY as Brazil (day first), not US month first', () => {
      const d = parseFlexibleDate('12/03/2025')
      expect(d.getUTCFullYear()).toBe(2025)
      expect(d.getUTCMonth()).toBe(2)
      expect(d.getUTCDate()).toBe(12)
    })

    it('ignores trailing time on DD/MM/YYYY', () => {
      const d = parseFlexibleDate('26/08/2025 14:04')
      expect(d.getUTCFullYear()).toBe(2025)
      expect(d.getUTCMonth()).toBe(7)
      expect(d.getUTCDate()).toBe(26)
    })

    it('parses compact 8 digits as DDMMYYYY when first 4 are not a plausible year', () => {
      const d = parseFlexibleDate('26082025')
      expect(d.getUTCFullYear()).toBe(2025)
      expect(d.getUTCMonth()).toBe(7)
      expect(d.getUTCDate()).toBe(26)
    })

    it('parses compact 8 digits as YYYYMMDD when year-first', () => {
      const d = parseFlexibleDate('20250315')
      expect(d.getUTCFullYear()).toBe(2025)
      expect(d.getUTCMonth()).toBe(2)
      expect(d.getUTCDate()).toBe(15)
    })

    it('parses ISO date', () => {
      const d = parseFlexibleDate('2025-03-15')
      expect(d.getUTCFullYear()).toBe(2025)
      expect(d.getUTCMonth()).toBe(2)
      expect(d.getUTCDate()).toBe(15)
    })
  })

  describe('ambiguous inputs the heuristic cannot resolve safely', () => {
    it('reads a separator-delimited date day-first by default', () => {
      const d = parseFlexibleDate('03/04/2026')
      expect(d.getUTCMonth()).toBe(3) // April
      expect(d.getUTCDate()).toBe(3)
    })

    it('a stated MDY order wins even when it contradicts the day-first default', () => {
      // Same string, opposite reading: month-first for a stated US bank.
      const d = parseFlexibleDate('03/04/2026', { order: 'MDY' })
      expect(d.getUTCMonth()).toBe(2) // March
      expect(d.getUTCDate()).toBe(4)
    })

    it('a stated order wins for compact 8-digit dates too', () => {
      // '01021900' is ambiguous between YMD (year 0102, invalid) and DMY;
      // use a string where each reading is plausible and distinct.
      const dmy = parseFlexibleDate('01022026', { order: 'DMY' })
      expect(dmy.getUTCMonth()).toBe(1) // February
      expect(dmy.getUTCDate()).toBe(1)

      const mdy = parseFlexibleDate('01022026', { order: 'MDY' })
      expect(mdy.getUTCMonth()).toBe(0) // January
      expect(mdy.getUTCDate()).toBe(2)

      const ymd = parseFlexibleDate('20260102', { order: 'YMD' })
      expect(ymd.getUTCFullYear()).toBe(2026)
      expect(ymd.getUTCMonth()).toBe(0) // January
      expect(ymd.getUTCDate()).toBe(2)
    })

    it('ISO dates stay year-first even when a different order is stated', () => {
      // Unambiguous representations are never reinterpreted.
      const d = parseFlexibleDate('2026-04-03', { order: 'MDY' })
      expect(d.getUTCFullYear()).toBe(2026)
      expect(d.getUTCMonth()).toBe(3)
      expect(d.getUTCDate()).toBe(3)
    })
  })
})
