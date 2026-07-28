/**
 * Domain enums as const objects plus matching type aliases.
 *
 * Declaration merging makes each name usable as a value (`TransactionKind.EXPENSE`)
 * and as a type (`kind: TransactionKind`), which is what lets the API import these
 * in place of Prisma-generated enums without touching call sites.
 *
 * Values are persisted verbatim in the database.
 */

export const ChartDateMode = {
  BILLING_CYCLE: 'BILLING_CYCLE',
  PURCHASE_DATE: 'PURCHASE_DATE',
} as const
export type ChartDateMode = (typeof ChartDateMode)[keyof typeof ChartDateMode]

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  TRIALING: 'TRIALING',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
} as const
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

export const SubscriptionPlan = {
  MONTHLY: 'MONTHLY',
  ANNUAL: 'ANNUAL',
  LIFETIME: 'LIFETIME',
} as const
export type SubscriptionPlan =
  (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan]

export const AiCategorizationMode = {
  OFF: 'OFF',
  SERVER: 'SERVER',
  BYOK: 'BYOK',
} as const
export type AiCategorizationMode =
  (typeof AiCategorizationMode)[keyof typeof AiCategorizationMode]

export const SourceType = {
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  CREDIT_CARD: 'CREDIT_CARD',
  CASH: 'CASH',
  MANUAL: 'MANUAL',
} as const
export type SourceType = (typeof SourceType)[keyof typeof SourceType]

export const CategoryType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType]

export const TransactionKind = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const
export type TransactionKind =
  (typeof TransactionKind)[keyof typeof TransactionKind]

export const RecurrenceFrequency = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const
export type RecurrenceFrequency =
  (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency]

export const RecurrenceEndMode = {
  INDEFINITE: 'INDEFINITE',
  UNTIL_DATE: 'UNTIL_DATE',
} as const
export type RecurrenceEndMode =
  (typeof RecurrenceEndMode)[keyof typeof RecurrenceEndMode]

export const CategorizationMatchType = {
  CONTAINS: 'CONTAINS',
  EQUALS: 'EQUALS',
} as const
export type CategorizationMatchType =
  (typeof CategorizationMatchType)[keyof typeof CategorizationMatchType]

export const ImportBatchFormat = {
  CSV: 'CSV',
  OFX: 'OFX',
  PDF_BANRISUL_CC: 'PDF_BANRISUL_CC',
  PDF_CRESOL_STATEMENT: 'PDF_CRESOL_STATEMENT',
} as const
export type ImportBatchFormat =
  (typeof ImportBatchFormat)[keyof typeof ImportBatchFormat]

export const ImportBatchStatus = {
  COMPLETED: 'COMPLETED',
} as const
export type ImportBatchStatus =
  (typeof ImportBatchStatus)[keyof typeof ImportBatchStatus]
