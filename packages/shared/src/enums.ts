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

/**
 * Which of the user's own credentials categorization uses under
 * `AiCategorizationMode.BYOK`.
 *
 * `BYOK` says *whose* credential, not *which vendor*, and there are two
 * kinds: an Anthropic API key and a ChatGPT plan. Persisted and
 * user-facing, which is why it is an enum here and not an `AiProvider.id`
 * -- `ai-provider.interface.ts` states that ids are never shown to a user
 * and never persisted, and this must not be the exception that breaks it.
 * The mapping from a value here to a provider id lives in
 * `AiCategorizerSelector`.
 *
 * `null` on a user means "not chosen", which matters only when both
 * sources are available: with one, it is used without asking.
 */
export const AiByokSource = {
  ANTHROPIC_KEY: 'ANTHROPIC_KEY',
  CHATGPT_PLAN: 'CHATGPT_PLAN',
} as const
export type AiByokSource = (typeof AiByokSource)[keyof typeof AiByokSource]

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

/**
 * Narrows a raw `string` (as read from a TEXT column) into one of these enum
 * const objects' literal values, throwing if it isn't one.
 *
 * The database `CHECK` constraint is the runtime guarantee that a persisted
 * value is always a member of the enum; this function is the corresponding
 * static-to-dynamic boundary check on the read path, so a value that somehow
 * violates that guarantee fails loudly instead of silently corrupting a
 * downstream DTO.
 */
export function parseEnum<T extends Record<string, string>>(
  enumObject: T,
  value: string,
  fieldName: string,
): T[keyof T] {
  const allowed = Object.values(enumObject)
  if (!allowed.includes(value)) {
    throw new RangeError(
      `Invalid ${fieldName}: ${JSON.stringify(value)} (expected one of ${allowed.join(', ')})`,
    )
  }
  return value as T[keyof T]
}
