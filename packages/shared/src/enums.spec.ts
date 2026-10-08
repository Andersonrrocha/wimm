import {
  AiByokSource,
  AiCategorizationMode,
  CategorizationMatchType,
  CategoryType,
  ChartDateMode,
  ImportBatchFormat,
  ImportBatchStatus,
  parseEnum,
  RecurrenceEndMode,
  RecurrenceFrequency,
  SourceType,
  SubscriptionPlan,
  SubscriptionStatus,
  TransactionKind,
} from './enums'

/**
 * These literals are persisted in the database. Changing one is a data
 * migration, never a rename. This test exists to make that impossible by accident.
 */
describe('domain enums', () => {
  it('exposes the persisted literals', () => {
    expect(ChartDateMode).toEqual({
      BILLING_CYCLE: 'BILLING_CYCLE',
      PURCHASE_DATE: 'PURCHASE_DATE',
    })
    expect(SubscriptionStatus).toEqual({
      ACTIVE: 'ACTIVE',
      TRIALING: 'TRIALING',
      EXPIRED: 'EXPIRED',
      CANCELED: 'CANCELED',
    })
    expect(SubscriptionPlan).toEqual({
      MONTHLY: 'MONTHLY',
      ANNUAL: 'ANNUAL',
      LIFETIME: 'LIFETIME',
    })
    expect(AiCategorizationMode).toEqual({
      OFF: 'OFF',
      SERVER: 'SERVER',
      BYOK: 'BYOK',
    })
    expect(SourceType).toEqual({
      BANK_ACCOUNT: 'BANK_ACCOUNT',
      CREDIT_CARD: 'CREDIT_CARD',
      CASH: 'CASH',
      MANUAL: 'MANUAL',
    })
    expect(CategoryType).toEqual({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' })
    expect(TransactionKind).toEqual({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' })
    expect(RecurrenceFrequency).toEqual({
      WEEKLY: 'WEEKLY',
      MONTHLY: 'MONTHLY',
      YEARLY: 'YEARLY',
    })
    expect(RecurrenceEndMode).toEqual({
      INDEFINITE: 'INDEFINITE',
      UNTIL_DATE: 'UNTIL_DATE',
    })
    expect(CategorizationMatchType).toEqual({
      CONTAINS: 'CONTAINS',
      EQUALS: 'EQUALS',
    })
    expect(ImportBatchFormat).toEqual({
      CSV: 'CSV',
      OFX: 'OFX',
      PDF_BANRISUL_CC: 'PDF_BANRISUL_CC',
      PDF_CRESOL_STATEMENT: 'PDF_CRESOL_STATEMENT',
    })
    expect(ImportBatchStatus).toEqual({ COMPLETED: 'COMPLETED' })
  })

  it('exposes the BYOK credential sources', () => {
    expect(AiByokSource).toEqual({
      ANTHROPIC_KEY: 'ANTHROPIC_KEY',
      CHATGPT_PLAN: 'CHATGPT_PLAN',
    })
  })

  it('uses each key as its own value', () => {
    const all = [
      ChartDateMode,
      SubscriptionStatus,
      SubscriptionPlan,
      AiCategorizationMode,
      AiByokSource,
      SourceType,
      CategoryType,
      TransactionKind,
      RecurrenceFrequency,
      RecurrenceEndMode,
      CategorizationMatchType,
      ImportBatchFormat,
      ImportBatchStatus,
    ]
    for (const e of all) {
      for (const [key, value] of Object.entries(e)) {
        expect(key).toBe(value)
      }
    }
  })
})

/**
 * `parseEnum` narrows a raw TEXT column value (read from the database, typed
 * `string` by Prisma) back into the literal-union type these enums declare.
 * The database CHECK constraint guarantees the runtime value is valid; this
 * throws loudly if that guarantee is ever violated instead of trusting a
 * blind cast.
 */
describe('parseEnum', () => {
  it('returns the value narrowed to the enum type when it is a member', () => {
    const result = parseEnum(TransactionKind, 'EXPENSE', 'kind')
    expect(result).toBe('EXPENSE')
  })

  it('throws a RangeError naming the field when the value is not a member', () => {
    expect(() => parseEnum(TransactionKind, 'NOT_A_KIND', 'kind')).toThrow(
      RangeError,
    )
    expect(() => parseEnum(TransactionKind, 'NOT_A_KIND', 'kind')).toThrow(
      /kind/,
    )
  })
})
