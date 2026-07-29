/**
 * The CHECK constraints guarding the columns that were PostgreSQL enums before
 * phase 0. Single source of truth, consumed by:
 *   - scripts/assert-check-constraints.ts  (asserts PostgreSQL still has them)
 *   - scripts/inject-check-constraints.ts  (writes them into SQLite DDL)
 *   - scripts/assert-schema-parity.ts      (drift guard)
 *
 * These are the runtime guarantee behind every `string`-typed enum column in
 * apps/api. Changing a value here is a data migration, never a rename.
 */
export type CheckConstraint = {
  name: string
  table: string
  column: string
  values: readonly string[]
  /** Only User.subscriptionPlan; its CHECK must permit NULL. */
  nullable: boolean
}

export const CHECK_CONSTRAINTS: readonly CheckConstraint[] = [
  { name: 'User_chartDateMode_check', table: 'User', column: 'chartDateMode', values: ['BILLING_CYCLE', 'PURCHASE_DATE'], nullable: false },
  { name: 'User_subscriptionStatus_check', table: 'User', column: 'subscriptionStatus', values: ['ACTIVE', 'TRIALING', 'EXPIRED', 'CANCELED'], nullable: false },
  { name: 'User_subscriptionPlan_check', table: 'User', column: 'subscriptionPlan', values: ['MONTHLY', 'ANNUAL', 'LIFETIME'], nullable: true },
  { name: 'User_aiCategorizationMode_check', table: 'User', column: 'aiCategorizationMode', values: ['OFF', 'SERVER', 'BYOK'], nullable: false },
  { name: 'Source_type_check', table: 'Source', column: 'type', values: ['BANK_ACCOUNT', 'CREDIT_CARD', 'CASH', 'MANUAL'], nullable: false },
  { name: 'Category_type_check', table: 'Category', column: 'type', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'SystemCategorizationRule_kind_check', table: 'SystemCategorizationRule', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'CategorizationRule_matchType_check', table: 'CategorizationRule', column: 'matchType', values: ['CONTAINS', 'EQUALS'], nullable: false },
  { name: 'ImportBatch_format_check', table: 'ImportBatch', column: 'format', values: ['CSV', 'OFX', 'PDF_BANRISUL_CC', 'PDF_CRESOL_STATEMENT'], nullable: false },
  { name: 'ImportBatch_status_check', table: 'ImportBatch', column: 'status', values: ['COMPLETED'], nullable: false },
  { name: 'Recurrence_kind_check', table: 'Recurrence', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'Recurrence_frequency_check', table: 'Recurrence', column: 'frequency', values: ['WEEKLY', 'MONTHLY', 'YEARLY'], nullable: false },
  { name: 'Recurrence_endMode_check', table: 'Recurrence', column: 'endMode', values: ['INDEFINITE', 'UNTIL_DATE'], nullable: false },
  { name: 'Transaction_kind_check', table: 'Transaction', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
] as const

export function checkConstraintNames(): string[] {
  return CHECK_CONSTRAINTS.map((c) => c.name).sort()
}
