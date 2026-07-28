import { RecurrenceEndMode, TransactionKind } from '@wimm/shared'
import { sumRecurrenceCommitmentsInUtcMonth } from './future-commitments.util'

describe('sumRecurrenceCommitmentsInUtcMonth', () => {
  const emptySources = new Map()

  it('counts non-card recurrences by occurrence month (UTC)', () => {
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.EXPENSE,
        amountCents: 5000,
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
    expect(jan.recurringExpenseCents).toBe(5000)
    const feb = sumRecurrenceCommitmentsInUtcMonth(
      recurrences,
      emptySources,
      2026,
      2,
    )
    expect(feb.recurringExpenseCents).toBe(5000)
  })

  it('uses billing due month for credit card recurrences, not purchase month', () => {
    const sid = 'card-1'
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.EXPENSE,
        amountCents: 10000,
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
    expect(jan.recurringExpenseCents).toBe(0)
    const feb = sumRecurrenceCommitmentsInUtcMonth(recurrences, sources, 2026, 2)
    expect(feb.recurringExpenseCents).toBe(10000)
  })

  it('routes income recurrences to recurringIncomeCents', () => {
    const recurrences = [
      {
        id: 'r1',
        kind: TransactionKind.INCOME,
        amountCents: 20000,
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
    expect(apr.recurringIncomeCents).toBe(20000)
    expect(apr.recurringExpenseCents).toBe(0)
  })
})
