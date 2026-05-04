// Auth
export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export type AppLocale = 'en' | 'pt'

export interface AuthResponse extends AuthTokens {
  user: Pick<User, 'id' | 'email' | 'username' | 'createdAt' | 'preferredLocale'>
}

export interface RefreshTokenRequest {
  refreshToken: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

// User
export type ChartDateMode = 'BILLING_CYCLE' | 'PURCHASE_DATE'
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED'
export type SubscriptionPlan = 'MONTHLY' | 'ANNUAL' | 'LIFETIME'

export interface User {
  id: string
  email: string
  username: string
  preferredLocale: AppLocale
  /** Drives credit-card expense bucketing in reports/charts. */
  chartDateMode: ChartDateMode
  /** ISO timestamp when the user finished onboarding; null = show flow. */
  onboardedAt: string | null
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: SubscriptionPlan | null
  trialEndsAt: string | null
  /** 1..200 lifetime Founder slot; null when unassigned. */
  founderNumber: number | null
  createdAt: string
  updatedAt: string
}

export interface UpdateUserMeRequest {
  preferredLocale?: AppLocale
  chartDateMode?: ChartDateMode
}

// Generic API wrappers
export interface ApiResponse<T> {
  data: T
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiError {
  message: string
  statusCode: number
  error?: string
}

// Pagination query params
export interface PaginationParams {
  page?: number
  pageSize?: number
}

// Master data (aligned with Prisma enums)
export type SourceType = 'BANK_ACCOUNT' | 'CREDIT_CARD' | 'CASH' | 'MANUAL'
export type CategoryType = 'INCOME' | 'EXPENSE'
export type TransactionKind = 'INCOME' | 'EXPENSE'

export interface Source {
  id: string
  userId: string
  name: string
  type: SourceType
  /** Calendar day (1–31). Set only when type is CREDIT_CARD. */
  closingDay?: number | null
  /** Calendar day (1–31). Set only when type is CREDIT_CARD. */
  dueDay?: number | null
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  userId: string
  name: string
  type: CategoryType
  categoryKey?: string | null
  parentId?: string | null
  parent?: { id: string; name: string; categoryKey?: string | null } | null
  createdAt: string
  updatedAt: string
}

export interface Transaction {
  id: string
  userId: string
  sourceId: string | null
  categoryId: string | null
  importBatchId: string | null
  recurrenceId: string | null
  kind: TransactionKind
  amount: string
  description: string
  occurredAt: string
  fingerprint: string | null
  /** Set when source is a credit card; otherwise null. */
  billingCycleMonth?: number | null
  billingCycleYear?: number | null
  expectedDueDate?: string | null
  /** Credit card statement imports when parsed (e.g. Banrisul). */
  installmentCurrent?: number | null
  installmentTotal?: number | null
  /** Set when this row belongs to a credit card installment plan. */
  installmentPlanId?: string | null
  /** Generated future obligation; false once matched to a real statement import (reconciliation). */
  isProjected?: boolean
  /** True when the row comes from a statement import (including reconciled projections). */
  isConfirmedFromImport?: boolean
  createdAt: string
  updatedAt: string
}

export type RecurrenceFrequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type RecurrenceEndMode = 'INDEFINITE' | 'UNTIL_DATE'

export interface Recurrence {
  id: string
  userId: string
  kind: TransactionKind
  amount: string
  description: string
  sourceId: string | null
  categoryId: string | null
  frequency: RecurrenceFrequency
  startDate: string
  endMode: RecurrenceEndMode
  endDate: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface MaterializeRequest {
  until: string
  recurrenceId?: string
}

export interface MaterializeResponse {
  created: number
}

// Imports (CSV / OFX / bank-specific PDF)
export type ImportBatchFormat =
  | 'CSV'
  | 'OFX'
  | 'PDF_BANRISUL_CC'
  | 'PDF_CRESOL_STATEMENT'

export type ImportParserWarningSeverity = 'info' | 'warning'

/**
 * Parser diagnostics for import preview (any bank-specific PDF/text parser).
 * Non-fatal: preview still returns parsed rows unless the file is unsupported.
 */
export interface ImportParserWarning {
  code: string
  message: string
  /** Single-line or short snippet (e.g. Banrisul transaction line). */
  rawLine?: string
  /** Multi-line source block (e.g. Cresol movement block). Prefer for display when set. */
  rawBlock?: string
  cardLast4?: string
  expectedTotal?: number
  actualTotal?: number
  delta?: number
  /** Defaults to `warning` when omitted (older clients). */
  severity?: ImportParserWarningSeverity
}

export interface ImportPreviewRow {
  occurredAt: string
  kind: TransactionKind
  amount: string
  description: string
  fingerprint: string
  isDuplicate: boolean
  suggestedCategoryId: string | null
  /** Banrisul-style installment when parsed (current/total). */
  installmentCurrent?: number
  installmentTotal?: number
}

/**
 * Billing snapshot from an imported credit card statement (preview → commit).
 * `paymentDueDate` is the invoice due date from the file; `statementClosingDate` is optional (e.g. document date).
 */
export interface ImportStatementBilling {
  paymentDueDate: string
  statementClosingDate?: string
}

export interface ImportPreviewResponse {
  format: ImportBatchFormat
  fileName: string
  rows: ImportPreviewRow[]
  totalParsed: number
  duplicateCount: number
  newCount: number
  /**
   * When the source is a credit card and the parser extracted a due date from the statement.
   */
  statementBilling?: ImportStatementBilling
  /**
   * Bank-specific PDF parsers attach diagnostics here.
   * For `PDF_BANRISUL_CC` and `PDF_CRESOL_STATEMENT`, always present when applicable (may be empty).
   * Omitted for CSV/OFX.
   */
  parserWarnings?: ImportParserWarning[]
}

export interface CommitImportRow {
  occurredAt: string
  kind: TransactionKind
  amount: number
  description: string
  categoryId?: string
  installmentCurrent?: number
  installmentTotal?: number
}

export interface CommitImportRequest {
  sourceId: string
  fileName: string
  format: ImportBatchFormat
  rows: CommitImportRow[]
  /** Echo from import preview when the statement included a due date; used only for CREDIT_CARD sources. */
  statementBilling?: ImportStatementBilling
}

export interface CommitImportResponse {
  importBatchId: string
  created: number
  skippedDuplicates: number
}

export interface ReportSummaryResponse {
  income: string
  expense: string
  net: string
}

export interface CategoryReportRow {
  categoryId: string | null
  categoryKey?: string | null
  name: string
  kind: TransactionKind
  total: string
}

export interface ReportByCategoryResponse {
  items: CategoryReportRow[]
}

export interface MonthlyReportMonth {
  month: number
  label: string
  income: string
  expense: string
  net: string
}

export interface ReportMonthlyResponse {
  year: number
  months: MonthlyReportMonth[]
}

export interface ReportFutureCommitmentsCardRow {
  sourceId: string
  sourceName: string
  total: string
}

export interface ReportFutureCommitmentsResponse {
  year: number
  month: number
  recurringExpenseTotal: string
  recurringIncomeTotal: string
  cardInstallmentsTotal: string
  totalCommittedExpense: string
  cardBySource: ReportFutureCommitmentsCardRow[]
}

export type CategorizationMatchType = 'CONTAINS' | 'EQUALS'

export interface CategorizationRule {
  id: string
  userId: string
  priority: number
  matchType: CategorizationMatchType
  pattern: string
  categoryId: string
  active: boolean
  createdAt: string
  updatedAt: string
  category: Category
}

export {
  groupSourcesForImportSelect,
  type SourceForImportGrouping,
  type SourceTypeForImport,
  type SourcesGroupedForImportSelect,
} from './group-sources-for-import'

export {
  BillingCycleInputError,
  calculateCreditCardBillingCycleContext,
  type CreditCardBillingCycleContext,
} from './credit-card-billing-cycle'
