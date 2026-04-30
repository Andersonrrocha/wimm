/**
 * Credit card billing cycle context (pure domain).
 *
 * All calendar logic uses **UTC** date fields (`getUTC*`) so results are
 * deterministic regardless of server/runtime timezone.
 *
 * ## Cycle assignment
 * Compares the purchase's **calendar day of month** (UTC) to `closingDay`:
 * - If `purchaseDay <= closingDay`, the purchase belongs to the cycle that
 *   closes in the **same** calendar month as the purchase.
 * - If `purchaseDay > closingDay`, it belongs to the cycle that closes in the
 *   **next** calendar month (month/year roll forward as needed).
 *
 * `closingDay` and `dueDay` are card configuration values (1–31). They are
 * **not** clamped when classifying the cycle—only the numeric comparison matters.
 * For example, `closingDay = 31` in February still compares against purchase
 * day 15 as `15 <= 31` (February cycle).
 *
 * ## Due date
 * The payment due date is the `dueDay` of the calendar month **immediately after**
 * the billing cycle month (the month whose closing defines the cycle).
 * If `dueDay` exceeds the length of that month, it is **clamped** to the last
 * day of the month (e.g. due 31 in April → April 30; due 31 in February → 28/29).
 *
 * This one-month offset is an explicit product assumption; issuers may differ.
 */

export interface CreditCardBillingCycleContext {
  /** Calendar month (1–12, UTC) of the statement close for this cycle */
  billingCycleMonth: number
  /** Calendar year (UTC) of the statement close for this cycle */
  billingCycleYear: number
  /** Payment due date at UTC midnight, with due-day clamping applied */
  expectedDueDate: Date
}

export class BillingCycleInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingCycleInputError'
  }
}

function assertValidDay(field: string, day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new BillingCycleInputError(
      `${field} must be an integer from 1 to 31, got ${String(day)}`,
    )
  }
}

function utcDaysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate()
}

function addCalendarMonths(
  year: number,
  month1To12: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = month1To12 - 1 + delta
  const y = year + Math.floor(zeroBased / 12)
  const m = ((zeroBased % 12) + 12) % 12
  return { year: y, month: m + 1 }
}

/**
 * Computes billing cycle month/year (UTC) and the expected due date for a purchase.
 *
 * @param purchaseDate - Purchase instant; UTC date parts are used
 * @param closingDay - Card closing calendar day (1–31)
 * @param dueDay - Card due calendar day (1–31)
 */
export function calculateCreditCardBillingCycleContext(
  purchaseDate: Date,
  closingDay: number,
  dueDay: number,
): CreditCardBillingCycleContext {
  assertValidDay('closingDay', closingDay)
  assertValidDay('dueDay', dueDay)

  if (!(purchaseDate instanceof Date) || Number.isNaN(purchaseDate.getTime())) {
    throw new BillingCycleInputError('purchaseDate must be a valid Date')
  }

  const y = purchaseDate.getUTCFullYear()
  const m = purchaseDate.getUTCMonth() + 1
  const d = purchaseDate.getUTCDate()

  let billingCycleYear: number
  let billingCycleMonth: number

  if (d <= closingDay) {
    billingCycleYear = y
    billingCycleMonth = m
  } else {
    const next = addCalendarMonths(y, m, 1)
    billingCycleYear = next.year
    billingCycleMonth = next.month
  }

  const due = addCalendarMonths(billingCycleYear, billingCycleMonth, 1)
  const dim = utcDaysInMonth(due.year, due.month)
  const dueCalendarDay = Math.min(dueDay, dim)
  const expectedDueDate = new Date(
    Date.UTC(due.year, due.month - 1, dueCalendarDay),
  )

  return {
    billingCycleMonth,
    billingCycleYear,
    expectedDueDate,
  }
}
