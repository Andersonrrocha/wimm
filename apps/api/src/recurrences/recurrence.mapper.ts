import {
  fromCents,
  parseEnum,
  RecurrenceEndMode,
  RecurrenceFrequency,
  TransactionKind,
  type Recurrence,
} from '@wimm/shared'

/**
 * Shape this mapper accepts. Declared structurally rather than importing the
 * Prisma model so the money field can change representation independently of
 * call sites. Task 9 moved it from `Decimal` to integer cents; Task 10 dropped
 * the `Decimal` column entirely.
 */
export type RecurrenceRow = {
  id: string
  userId: string
  kind: string
  amountCents: number
  description: string
  sourceId: string | null
  categoryId: string | null
  frequency: string
  startDate: Date
  endMode: string
  endDate: Date | null
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export function toRecurrenceDto(row: RecurrenceRow): Recurrence {
  return {
    id: row.id,
    userId: row.userId,
    // Task 3 added parseEnum for exactly this boundary — do not cast blindly.
    kind: parseEnum(TransactionKind, row.kind, 'kind'),
    amount: fromCents(row.amountCents),
    description: row.description,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    frequency: parseEnum(RecurrenceFrequency, row.frequency, 'frequency'),
    startDate: row.startDate.toISOString(),
    endMode: parseEnum(RecurrenceEndMode, row.endMode, 'endMode'),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
