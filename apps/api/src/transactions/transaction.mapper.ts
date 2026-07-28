import type { Prisma } from '@prisma/client'
import { parseEnum, TransactionKind, type Transaction } from '@wimm/shared'

/**
 * Shape this mapper accepts. Declared structurally rather than importing the
 * Prisma model so the money field can change representation (Task 9 moves it
 * from `Decimal` to integer cents) without rippling through call sites.
 */
export type TransactionRow = {
  id: string
  userId: string
  sourceId: string | null
  categoryId: string | null
  importBatchId: string | null
  installmentPlanId: string | null
  isProjected: boolean
  isConfirmedFromImport: boolean
  recurrenceId: string | null
  kind: string
  amount: Prisma.Decimal
  description: string
  occurredAt: Date
  fingerprint: string | null
  billingCycleMonth: number | null
  billingCycleYear: number | null
  expectedDueDate: Date | null
  installmentCurrent: number | null
  installmentTotal: number | null
  createdAt: Date
  updatedAt: Date
}

export function toTransactionDto(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    importBatchId: row.importBatchId,
    recurrenceId: row.recurrenceId,
    // Task 3 added parseEnum for exactly this boundary — do not cast blindly.
    kind: parseEnum(TransactionKind, row.kind, 'kind'),
    amount: row.amount.toFixed(2),
    description: row.description,
    occurredAt: row.occurredAt.toISOString(),
    fingerprint: row.fingerprint,
    billingCycleMonth: row.billingCycleMonth,
    billingCycleYear: row.billingCycleYear,
    expectedDueDate: row.expectedDueDate ? row.expectedDueDate.toISOString() : null,
    installmentCurrent: row.installmentCurrent,
    installmentTotal: row.installmentTotal,
    installmentPlanId: row.installmentPlanId,
    isProjected: row.isProjected,
    isConfirmedFromImport: row.isConfirmedFromImport,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
