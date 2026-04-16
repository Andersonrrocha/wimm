import { RecurrenceFrequency } from '@prisma/client'

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

export function nextOccurrence(
  d: Date,
  frequency: RecurrenceFrequency,
): Date {
  switch (frequency) {
    case 'WEEKLY':
      return addWeeksUtc(d, 1)
    case 'MONTHLY':
      return addMonthsUtc(d, 1)
    case 'YEARLY':
      return addYearsUtc(d, 1)
    default:
      return addMonthsUtc(d, 1)
  }
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
