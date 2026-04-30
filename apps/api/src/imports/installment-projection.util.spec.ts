import { SourceType, TransactionKind } from '@prisma/client'
import {
  addCalendarMonthsUtc,
  buildProjectedInstallmentDescription,
  buildProjectedInstallmentRows,
} from './installment-projection.util'
import type { SourceBillingInput } from '../transactions/transaction-billing.util'

const ccSource: SourceBillingInput = {
  type: SourceType.CREDIT_CARD,
  closingDay: 25,
  dueDay: 10,
}

describe('addCalendarMonthsUtc', () => {
  it('advances Jan 10 by one month', () => {
    const d = addCalendarMonthsUtc(new Date(Date.UTC(2024, 0, 10)), 1)
    expect(d.toISOString().startsWith('2024-02-10')).toBe(true)
  })

  it('clamps Jan 31 to February last day', () => {
    const d = addCalendarMonthsUtc(new Date(Date.UTC(2024, 0, 31)), 1)
    expect(d.getUTCMonth()).toBe(1)
    expect(d.getUTCDate()).toBe(29)
  })
})

describe('buildProjectedInstallmentRows', () => {
  it('creates 2/5..5/5 when importing 1/5', () => {
    const base = new Date(Date.UTC(2024, 0, 10))
    const rows = buildProjectedInstallmentRows({
      userId: 'u1',
      installmentPlanId: 'plan-1',
      sourceBilling: ccSource,
      baseDescription: 'MERCADO',
      baseOccurredAt: base,
      importedCurrent: 1,
      installmentTotal: 5,
      amount: 100,
      kind: TransactionKind.EXPENSE,
    })
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.installmentCurrent)).toEqual([2, 3, 4, 5])
    expect(rows[0].occurredAt.toISOString().startsWith('2024-02-10')).toBe(true)
    expect(rows[3].occurredAt.toISOString().startsWith('2024-05-10')).toBe(true)
    expect(rows[0].billing.billingCycleMonth).toBe(2)
    expect(rows[0].billing.billingCycleYear).toBe(2024)
    expect(rows[0].description).toContain('2/5')
    expect(rows[0].description).toContain('(projected)')
  })

  it('creates only 3/5..5/5 when importing 2/5 (no backfill)', () => {
    const base = new Date(Date.UTC(2024, 1, 10))
    const rows = buildProjectedInstallmentRows({
      userId: 'u1',
      installmentPlanId: 'plan-1',
      sourceBilling: ccSource,
      baseDescription: 'X',
      baseOccurredAt: base,
      importedCurrent: 2,
      installmentTotal: 5,
      amount: 50,
      kind: TransactionKind.EXPENSE,
    })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.installmentCurrent)).toEqual([3, 4, 5])
  })

  it('creates no rows when importing the final leg', () => {
    const rows = buildProjectedInstallmentRows({
      userId: 'u1',
      installmentPlanId: 'plan-1',
      sourceBilling: ccSource,
      baseDescription: 'X',
      baseOccurredAt: new Date(Date.UTC(2024, 4, 10)),
      importedCurrent: 5,
      installmentTotal: 5,
      amount: 50,
      kind: TransactionKind.EXPENSE,
    })
    expect(rows).toHaveLength(0)
  })

  it('uses importStatementBaseline for billing instead of source rules', () => {
    const base = new Date(Date.UTC(2026, 1, 10))
    const due = new Date(Date.UTC(2026, 3, 6, 12, 0, 0))
    const rows = buildProjectedInstallmentRows({
      userId: 'u1',
      installmentPlanId: 'plan-1',
      sourceBilling: ccSource,
      baseDescription: 'X',
      baseOccurredAt: base,
      importedCurrent: 1,
      installmentTotal: 3,
      amount: 50,
      kind: TransactionKind.EXPENSE,
      importStatementBaseline: { dueDate: due },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].billing.expectedDueDate).toEqual(
      new Date(Date.UTC(2026, 4, 6, 12, 0, 0)),
    )
    expect(rows[0].billing.billingCycleMonth).toBe(4)
    expect(rows[0].billing.billingCycleYear).toBe(2026)
  })
})

describe('buildProjectedInstallmentDescription', () => {
  it('fits within 512 characters', () => {
    const long = 'x'.repeat(600)
    const d = buildProjectedInstallmentDescription(long, 2, 5)
    expect(d.length).toBeLessThanOrEqual(512)
    expect(d.endsWith(' · 2/5 (projected)')).toBe(true)
  })
})
