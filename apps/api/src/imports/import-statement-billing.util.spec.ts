import {
  billingFieldsForProjectedInstallmentLeg,
  billingFieldsFromStatementBilling,
} from './import-statement-billing.util'

describe('billingFieldsFromStatementBilling', () => {
  it('sets expectedDueDate from payment due and cycle from explicit closing', () => {
    const r = billingFieldsFromStatementBilling({
      paymentDueDate: new Date(Date.UTC(2026, 3, 6, 0, 0, 0)),
      statementClosingDate: new Date(Date.UTC(2026, 2, 25, 0, 0, 0)),
    })
    expect(r.billingCycleMonth).toBe(3)
    expect(r.billingCycleYear).toBe(2026)
    expect(r.expectedDueDate).toEqual(new Date(Date.UTC(2026, 3, 6, 12, 0, 0)))
  })

  it('derives cycle as month before due when closing omitted', () => {
    const r = billingFieldsFromStatementBilling({
      paymentDueDate: new Date(Date.UTC(2026, 3, 6, 0, 0, 0)),
    })
    expect(r.billingCycleMonth).toBe(3)
    expect(r.billingCycleYear).toBe(2026)
    expect(r.expectedDueDate).toEqual(new Date(Date.UTC(2026, 3, 6, 12, 0, 0)))
  })

  it('rolls cycle year back when due is in January', () => {
    const r = billingFieldsFromStatementBilling({
      paymentDueDate: new Date(Date.UTC(2026, 0, 10, 0, 0, 0)),
    })
    expect(r.billingCycleMonth).toBe(12)
    expect(r.billingCycleYear).toBe(2025)
  })
})

describe('billingFieldsForProjectedInstallmentLeg', () => {
  it('advances due and cycle from statement baseline without closing', () => {
    const leg = billingFieldsForProjectedInstallmentLeg({
      dueDateAfterDelta: new Date(Date.UTC(2026, 4, 6, 12, 0, 0)),
    })
    expect(leg.expectedDueDate).toEqual(new Date(Date.UTC(2026, 4, 6, 12, 0, 0)))
    expect(leg.billingCycleMonth).toBe(4)
    expect(leg.billingCycleYear).toBe(2026)
  })

  it('uses shifted closing for cycle when provided', () => {
    const leg = billingFieldsForProjectedInstallmentLeg({
      dueDateAfterDelta: new Date(Date.UTC(2026, 4, 10, 12, 0, 0)),
      closingDateAfterDelta: new Date(Date.UTC(2026, 3, 28, 12, 0, 0)),
    })
    expect(leg.billingCycleMonth).toBe(4)
    expect(leg.billingCycleYear).toBe(2026)
  })
})
