import { SourceType } from '@prisma/client'
import {
  resolveTransactionBillingFields,
  TransactionBillingConfigError,
} from './transaction-billing.util'

function utc(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d))
}

describe('resolveTransactionBillingFields', () => {
  it('returns nulls when source is null', () => {
    expect(
      resolveTransactionBillingFields(null, utc(2024, 0, 10)),
    ).toEqual({
      billingCycleMonth: null,
      billingCycleYear: null,
      expectedDueDate: null,
    })
  })

  it('returns nulls for non–credit-card source', () => {
    expect(
      resolveTransactionBillingFields(
        {
          type: SourceType.BANK_ACCOUNT,
          closingDay: null,
          dueDay: null,
        },
        utc(2024, 0, 10),
      ),
    ).toEqual({
      billingCycleMonth: null,
      billingCycleYear: null,
      expectedDueDate: null,
    })
  })

  it('populates billing fields for credit card source', () => {
    const r = resolveTransactionBillingFields(
      {
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 10,
      },
      utc(2024, 0, 10),
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 1, 10))
  })

  it('uses next cycle when purchase is after closing day (month rollover)', () => {
    const r = resolveTransactionBillingFields(
      {
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 15,
      },
      utc(2024, 0, 26),
    )
    expect(r.billingCycleMonth).toBe(2)
    expect(r.billingCycleYear).toBe(2024)
    expect(r.expectedDueDate).toEqual(utc(2024, 2, 15))
  })

  it('handles year rollover after December closing', () => {
    const r = resolveTransactionBillingFields(
      {
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 12,
      },
      utc(2024, 11, 26),
    )
    expect(r.billingCycleMonth).toBe(1)
    expect(r.billingCycleYear).toBe(2025)
    expect(r.expectedDueDate).toEqual(utc(2025, 1, 12))
  })

  it('throws when credit card source lacks closing or due day', () => {
    expect(() =>
      resolveTransactionBillingFields(
        {
          type: SourceType.CREDIT_CARD,
          closingDay: 25,
          dueDay: null,
        },
        utc(2024, 0, 1),
      ),
    ).toThrow(TransactionBillingConfigError)
  })
})
