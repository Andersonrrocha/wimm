import { Prisma, RecurrenceEndMode, TransactionKind } from '@prisma/client'
import type { RecurrenceFrequency } from '@prisma/client'
import {
  resolveTransactionBillingFields,
  type SourceBillingInput,
  TransactionBillingConfigError,
} from '../transactions/transaction-billing.util'
import {
  endOfUtcDayFromDateString,
  nextOccurrence,
  toUtcDateKey,
} from '../recurrences/recurrence-dates'

const MAX_RECURRENCE_STEPS = 5_000

export type RecurrenceRowForForecast = {
  id: string
  kind: TransactionKind
  amount: Prisma.Decimal
  frequency: RecurrenceFrequency
  startDate: Date
  endMode: RecurrenceEndMode
  endDate: Date | null
  sourceId: string | null
}

export function utcMonthBounds(year: number, month: number): {
  monthStart: Date
  monthEnd: Date
} {
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return { monthStart, monthEnd }
}

function cashImpactDate(
  sourceBilling: SourceBillingInput,
  occurredAt: Date,
): Date {
  const billing = resolveTransactionBillingFields(sourceBilling, occurredAt)
  return billing.expectedDueDate ?? occurredAt
}

function isWithinRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/**
 * Sums recurrence rule cash impact in a UTC calendar month. For credit card
 * sources, uses expected due date (billing context), not purchase/occurrence
 * date alone.
 */
export function sumRecurrenceCommitmentsInUtcMonth(
  recurrences: RecurrenceRowForForecast[],
  sourceBillingById: Map<string, SourceBillingInput>,
  year: number,
  month: number,
): { recurringExpense: Prisma.Decimal; recurringIncome: Prisma.Decimal } {
  const { monthStart, monthEnd } = utcMonthBounds(year, month)
  let recurringExpense = new Prisma.Decimal(0)
  let recurringIncome = new Prisma.Decimal(0)

  for (const rec of recurrences) {
    const ruleEnd =
      rec.endMode === RecurrenceEndMode.UNTIL_DATE && rec.endDate
        ? endOfUtcDayFromDateString(toUtcDateKey(rec.endDate))
        : null

    const sourceBilling: SourceBillingInput = rec.sourceId
      ? (sourceBillingById.get(rec.sourceId) ?? null)
      : null

    try {
      resolveTransactionBillingFields(sourceBilling, new Date(rec.startDate))
    } catch (e) {
      if (e instanceof TransactionBillingConfigError) {
        continue
      }
      throw e
    }

    let cursor = new Date(rec.startDate)
    let steps = 0

    while (steps < MAX_RECURRENCE_STEPS) {
      if (ruleEnd && cursor.getTime() > ruleEnd.getTime()) break

      let impactAt: Date
      try {
        impactAt = cashImpactDate(sourceBilling, cursor)
      } catch (e) {
        if (e instanceof TransactionBillingConfigError) {
          break
        }
        throw e
      }

      if (isWithinRange(impactAt, monthStart, monthEnd)) {
        if (rec.kind === TransactionKind.EXPENSE) {
          recurringExpense = recurringExpense.plus(rec.amount)
        } else {
          recurringIncome = recurringIncome.plus(rec.amount)
        }
      }

      const next = nextOccurrence(cursor, rec.frequency)
      if (next.getTime() <= cursor.getTime()) break
      cursor = next
      steps++
    }
  }

  return { recurringExpense, recurringIncome }
}
