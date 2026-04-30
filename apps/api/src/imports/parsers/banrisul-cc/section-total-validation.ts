/**
 * Validate summed transaction amounts per card section against declared TOTAL DE GASTOS.
 */

export const SECTION_TOTAL_TOLERANCE = 0.01

export type BanrisulSectionTotalInput = {
  cardLast4: string
  declaredTotal?: number
}

export type BanrisulSectionTotalWarning = {
  code: 'missing_declared_total' | 'section_total_mismatch'
  message: string
  cardLast4: string
  expectedTotal?: number
  actualTotal?: number
  delta?: number
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function totalsMatch(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= SECTION_TOTAL_TOLERANCE
}

/**
 * For each section, sum transactions with the same cardLast4 and compare to declaredTotal.
 * Returns warnings only (never throws). Missing declared total or mismatch both emit warnings.
 */
export function validateBanrisulSectionTotals(
  sections: BanrisulSectionTotalInput[],
  transactions: Array<{ cardLast4: string; amount: number }>,
): BanrisulSectionTotalWarning[] {
  const sumByCard = new Map<string, number>()
  for (const t of transactions) {
    const prev = sumByCard.get(t.cardLast4) ?? 0
    sumByCard.set(t.cardLast4, prev + t.amount)
  }

  const out: BanrisulSectionTotalWarning[] = []

  for (const section of sections) {
    const actualRaw = sumByCard.get(section.cardLast4) ?? 0
    const actual = roundMoney(actualRaw)

    if (section.declaredTotal === undefined) {
      out.push({
        code: 'missing_declared_total',
        message: `No declared TOTAL DE GASTOS for card ending ${section.cardLast4}; cannot validate section sum (${actual.toFixed(2)} BRL parsed)`,
        cardLast4: section.cardLast4,
        actualTotal: actual,
      })
      continue
    }

    const expected = roundMoney(section.declaredTotal)
    if (!totalsMatch(expected, actual)) {
      const delta = roundMoney(actual - expected)
      out.push({
        code: 'section_total_mismatch',
        message: `Section total for card ${section.cardLast4}: expected ${expected.toFixed(2)} BRL, actual ${actual.toFixed(2)} BRL, delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} BRL`,
        cardLast4: section.cardLast4,
        expectedTotal: expected,
        actualTotal: actual,
        delta,
      })
    }
  }

  return out
}
