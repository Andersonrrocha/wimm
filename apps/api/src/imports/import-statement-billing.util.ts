/**
 * Maps statement-derived dates (import snapshot) to persisted Transaction billing fields.
 * Payment due is authoritative for expectedDueDate; billing cycle month/year identifies
 * the statement cycle (optional explicit closing date, else month before due).
 */

export type StatementBillingInput = {
  paymentDueDate: Date
  statementClosingDate?: Date
}

function toUtcNoonCalendarDate(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  )
}

function previousUtcCalendarMonth(
  year: number,
  month1To12: number,
): { year: number; month: number } {
  if (month1To12 === 1) {
    return { year: year - 1, month: 12 }
  }
  return { year, month: month1To12 - 1 }
}

export function billingFieldsFromStatementBilling(
  input: StatementBillingInput,
): {
  billingCycleMonth: number
  billingCycleYear: number
  expectedDueDate: Date
} {
  const expectedDueDate = toUtcNoonCalendarDate(input.paymentDueDate)

  let billingCycleMonth: number
  let billingCycleYear: number

  if (input.statementClosingDate) {
    const c = toUtcNoonCalendarDate(input.statementClosingDate)
    billingCycleYear = c.getUTCFullYear()
    billingCycleMonth = c.getUTCMonth() + 1
  } else {
    const d = expectedDueDate
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const prev = previousUtcCalendarMonth(y, m)
    billingCycleYear = prev.year
    billingCycleMonth = prev.month
  }

  return { billingCycleMonth, billingCycleYear, expectedDueDate }
}

/**
 * Billing for a projected installment leg after applying `monthsDelta` to baseline dates
 * (callers should pass `addCalendarMonthsUtc(baselineDue, delta)` / closing if any).
 */
export function billingFieldsForProjectedInstallmentLeg(input: {
  dueDateAfterDelta: Date
  closingDateAfterDelta?: Date
}): {
  billingCycleMonth: number
  billingCycleYear: number
  expectedDueDate: Date
} {
  const expectedDueDate = toUtcNoonCalendarDate(input.dueDateAfterDelta)

  let billingCycleMonth: number
  let billingCycleYear: number

  if (input.closingDateAfterDelta) {
    const c = toUtcNoonCalendarDate(input.closingDateAfterDelta)
    billingCycleYear = c.getUTCFullYear()
    billingCycleMonth = c.getUTCMonth() + 1
  } else {
    const d = expectedDueDate
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const prev = previousUtcCalendarMonth(y, m)
    billingCycleYear = prev.year
    billingCycleMonth = prev.month
  }

  return { billingCycleMonth, billingCycleYear, expectedDueDate }
}
