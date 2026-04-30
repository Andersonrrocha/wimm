import {
  BillingCycleInputError,
  calculateCreditCardBillingCycleContext,
} from './credit-card-billing-cycle'

function utc(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d))
}

describe('calculateCreditCardBillingCycleContext', () => {
  it('assigns purchase before closing day to the same calendar month cycle', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 0, 10),
      25,
      10,
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 1, 10))
  })

  it('assigns purchase on closing day to the current month cycle (inclusive)', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 0, 25),
      25,
      10,
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 1, 10))
  })

  it('assigns purchase after closing day to the next calendar month cycle', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 0, 26),
      25,
      10,
    )
    expect(r.billingCycleMonth).toBe(2)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 2, 10))
  })

  it('rolls billing cycle from December to January of the next year', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 11, 26),
      25,
      15,
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2025)
    expect(r.expectedDueDate).toEqual(utc(2025, 1, 15))
  })

  it('keeps December cycle when purchase is on or before December closing day', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 11, 5),
      25,
      20,
    )
    expect(r.billingCycleMonth).toBe(12)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2025, 0, 20))
  })

  it('rolls due month from December to January of the next year', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 11, 10),
      25,
      7,
    )
    expect(r.billingCycleMonth).toBe(12)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2025, 0, 7))
  })

  it('clamps due day 31 when the due month has 30 days', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 2, 10),
      25,
      31,
    )
    expect(r.billingCycleMonth).toBe(3)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 3, 30))
  })

  it('clamps due day 31 in February (non-leap year)', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2023, 0, 5),
      25,
      31,
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2023)
    expect(r.expectedDueDate).toEqual(utc(2023, 1, 28))
  })

  it('clamps due day 31 in February (leap year)', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 0, 5),
      25,
      31,
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 1, 29))
  })

  it('handles purchase on last day of month when closing is earlier (next cycle)', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 0, 31),
      15,
      10,
    )
    expect(r.billingCycleMonth).toBe(2)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 2, 10))
  })

  it('handles March 31 purchase with closing 31 (same month cycle)', () => {
    const r = calculateCreditCardBillingCycleContext(
      utc(2024, 2, 31),
      31,
      15,
    )
    expect(r.billingCycleMonth).toBe(3)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 3, 15))
  })

  it('throws for closingDay out of range', () => {
    expect(() =>
      calculateCreditCardBillingCycleContext(utc(2024, 0, 1), 0, 10),
    ).toThrow(BillingCycleInputError)
    expect(() =>
      calculateCreditCardBillingCycleContext(utc(2024, 0, 1), 32, 10),
    ).toThrow(BillingCycleInputError)
    expect(() =>
      calculateCreditCardBillingCycleContext(utc(2024, 0, 1), 15.5, 10),
    ).toThrow(BillingCycleInputError)
  })

  it('throws for dueDay out of range', () => {
    expect(() =>
      calculateCreditCardBillingCycleContext(utc(2024, 0, 1), 10, 0),
    ).toThrow(BillingCycleInputError)
    expect(() =>
      calculateCreditCardBillingCycleContext(utc(2024, 0, 1), 10, 32),
    ).toThrow(BillingCycleInputError)
  })

  it('throws for invalid purchase date', () => {
    expect(() =>
      calculateCreditCardBillingCycleContext(
        new Date(Number.NaN),
        10,
        10,
      ),
    ).toThrow(BillingCycleInputError)
  })
})
