import {
  SECTION_TOTAL_TOLERANCE,
  validateBanrisulSectionTotals,
} from './section-total-validation'

describe('validateBanrisulSectionTotals', () => {
  it('returns no warnings when section sum matches declared total', () => {
    const w = validateBanrisulSectionTotals(
      [{ cardLast4: '1570', declaredTotal: 225.98 }],
      [
        { cardLast4: '1570', amount: 108.92 },
        { cardLast4: '1570', amount: 117.06 },
      ],
    )
    expect(w).toHaveLength(0)
  })

  it('accepts match within tolerance', () => {
    const w = validateBanrisulSectionTotals(
      [{ cardLast4: '1000', declaredTotal: 10.01 }],
      [{ cardLast4: '1000', amount: 10.01 - SECTION_TOTAL_TOLERANCE }],
    )
    expect(w).toHaveLength(0)
  })

  it('emits section_total_mismatch when sums differ beyond tolerance', () => {
    const w = validateBanrisulSectionTotals(
      [{ cardLast4: '1570', declaredTotal: 200 }],
      [{ cardLast4: '1570', amount: 108.92 }],
    )
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('section_total_mismatch')
    expect(w[0].cardLast4).toBe('1570')
    expect(w[0].expectedTotal).toBe(200)
    expect(w[0].actualTotal).toBe(108.92)
    expect(w[0].delta).toBeCloseTo(-91.08, 2)
  })

  it('emits missing_declared_total when declaredTotal is undefined', () => {
    const w = validateBanrisulSectionTotals(
      [{ cardLast4: '9999', declaredTotal: undefined }],
      [{ cardLast4: '9999', amount: 42.5 }],
    )
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('missing_declared_total')
    expect(w[0].cardLast4).toBe('9999')
    expect(w[0].actualTotal).toBe(42.5)
    expect(w[0].expectedTotal).toBeUndefined()
  })

  it('validates multiple card sections independently', () => {
    const w = validateBanrisulSectionTotals(
      [
        { cardLast4: '1111', declaredTotal: 10 },
        { cardLast4: '2222', declaredTotal: 99 },
      ],
      [
        { cardLast4: '1111', amount: 10 },
        { cardLast4: '2222', amount: 50 },
      ],
    )
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('section_total_mismatch')
    expect(w[0].cardLast4).toBe('2222')
  })

  it('treats missing transactions for a card as actual total 0', () => {
    const w = validateBanrisulSectionTotals(
      [{ cardLast4: '3000', declaredTotal: 100 }],
      [],
    )
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('section_total_mismatch')
    expect(w[0].actualTotal).toBe(0)
  })
})
