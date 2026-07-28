import { calculateCreditCardBillingCycleContext, SourceType } from '@wimm/shared'

/**
 * Shape of a `Source` row as selected for billing-field resolution. `type` is
 * `string`, not the narrower `SourceType`, because it describes what the
 * database layer actually returns for a TEXT+CHECK column — the only
 * consumer here is an equality check against `SourceType.CREDIT_CARD`, which
 * works the same either way.
 */
export type SourceBillingInput = {
  type: string
  closingDay: number | null
  dueDay: number | null
} | null

export class TransactionBillingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionBillingConfigError'
  }
}

/**
 * Billing-cycle fields for persistence. Null when the transaction is not
 * tied to a credit card source.
 */
export function resolveTransactionBillingFields(
  source: SourceBillingInput,
  occurredAt: Date,
): {
  billingCycleMonth: number | null
  billingCycleYear: number | null
  expectedDueDate: Date | null
} {
  if (!source || source.type !== SourceType.CREDIT_CARD) {
    return {
      billingCycleMonth: null,
      billingCycleYear: null,
      expectedDueDate: null,
    }
  }
  if (source.closingDay == null || source.dueDay == null) {
    throw new TransactionBillingConfigError(
      'Credit card source is missing closingDay or dueDay',
    )
  }
  const ctx = calculateCreditCardBillingCycleContext(
    occurredAt,
    source.closingDay,
    source.dueDay,
  )
  return {
    billingCycleMonth: ctx.billingCycleMonth,
    billingCycleYear: ctx.billingCycleYear,
    expectedDueDate: ctx.expectedDueDate,
  }
}
