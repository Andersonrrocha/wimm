import type { RecurrenceFrequency } from '@wimm/shared'

/** Stable day key for idempotent recurrence transaction fingerprints */
export function dateKeyUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function recurrenceTransactionFingerprint(
  recurrenceId: string,
  occurredAt: Date,
): string {
  return `recurrence:${recurrenceId}:${dateKeyUtc(occurredAt)}`
}

export function addWeeksUtc(d: Date, weeks: number): Date {
  return new Date(d.getTime() + weeks * 7 * 24 * 60 * 60 * 1000)
}

export function addMonthsUtc(d: Date, delta: number): Date {
  const anchor = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1, 12, 0, 0),
  )
  const y = anchor.getUTCFullYear()
  const m = anchor.getUTCMonth()
  const lastDay = new Date(Date.UTC(y, m + 1, 0, 12, 0, 0)).getUTCDate()
  const day = Math.min(d.getUTCDate(), lastDay)
  return new Date(Date.UTC(y, m, day, 12, 0, 0))
}

export function addYearsUtc(d: Date, years: number): Date {
  return addMonthsUtc(d, years * 12)
}

/**
 * Advance a date by one recurrence step.
 *
 * The parameter is the narrow `RecurrenceFrequency` union, and the switch is
 * exhaustive with no `default:`. Adding a frequency to the union without
 * handling it here is a compile error. The runtime throw covers values that
 * reach us from a database with no CHECK constraint to reject them.
 */
export function nextOccurrence(d: Date, frequency: RecurrenceFrequency): Date {
  switch (frequency) {
    case 'WEEKLY':
      return addWeeksUtc(d, 1)
    case 'MONTHLY':
      return addMonthsUtc(d, 1)
    case 'YEARLY':
      return addYearsUtc(d, 1)
  }
  const unreachable: never = frequency
  throw new Error(`Unhandled recurrence frequency: ${String(unreachable)}`)
}

/** Inclusive upper bound for materialization horizon (end of UTC day). */
export function endOfUtcDayFromDateString(dateStr: string): Date {
  const parts = dateStr.slice(0, 10).split('-').map(Number)
  const [y, mo, day] = parts
  if (!y || !mo || !day) {
    throw new Error('Invalid date string')
  }
  return new Date(Date.UTC(y, mo - 1, day, 23, 59, 59, 999))
}

export function toUtcDateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
