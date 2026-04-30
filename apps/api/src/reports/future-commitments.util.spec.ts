import { Prisma, RecurrenceEndMode, TransactionKind } from '@prisma/client'
import { sumRecurrenceCommitmentsInUtcMonth } from './future-commitments.util'

describe('sumRecurrenceCommitmentsInUtcMonth', () => {
  const emptySources = new Map()

  it('counts non-card recurrences by occurrence month (UTC)', () => {
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.EXPENSE,
        amount: new Prisma.Decimal(50),
        frequency: 'MONTHLY' as const,
        startDate: new Date(Date.UTC(2026, 0, 15, 12, 0, 0)),
        endMode: RecurrenceEndMode.INDEFINITE,
        endDate: null,
        sourceId: null,
      },
    ]
    const jan = sumRecurrenceCommitmentsInUtcMonth(
      recurrences,
      emptySources,
      2026,
      1,
    )
    expect(jan.recurringExpense.toFixed(2)).toBe('50.00')
    const feb = sumRecurrenceCommitmentsInUtcMonth(
      recurrences,
      emptySources,
      2026,
      2,
    )
    expect(feb.recurringExpense.toFixed(2)).toBe('50.00')
  })

  it('uses billing due month for credit card recurrences, not purchase month', () => {
    const sid = 'card-1'
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.EXPENSE,
        amount: new Prisma.Decimal(100),
        frequency: 'MONTHLY' as const,
        startDate: new Date(Date.UTC(2026, 0, 5, 12, 0, 0)),
        endMode: RecurrenceEndMode.INDEFINITE,
        endDate: null,
        sourceId: sid,
      },
    ]
    const sources = new Map([
      [
        sid,
        {
          type: 'CREDIT_CARD' as const,
          closingDay: 25,
          dueDay: 10,
        },
      ],
    ])
    const jan = sumRecurrenceCommitmentsInUtcMonth(recurrences, sources, 2026, 1)
    expect(jan.recurringExpense.toFixed(2)).toBe('0.00')
    const feb = sumRecurrenceCommitmentsInUtcMonth(recurrences, sources, 2026, 2)
    expect(feb.recurringExpense.toFixed(2)).toBe('100.00')
  })

  it('routes income recurrences to recurringIncome', () => {
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.INCOME,
        amount: new Prisma.Decimal(200),
        frequency: 'MONTHLY' as const,
        startDate: new Date(Date.UTC(2026, 3, 1, 12, 0, 0)),
        endMode: RecurrenceEndMode.INDEFINITE,
        endDate: null,
        sourceId: null,
      },
    ]
    const apr = sumRecurrenceCommitmentsInUtcMonth(
      recurrences,
      emptySources,
      2026,
      4,
    )
    expect(apr.recurringIncome.toFixed(2)).toBe('200.00')
    expect(apr.recurringExpense.toFixed(2)).toBe('0.00')
  })
})
