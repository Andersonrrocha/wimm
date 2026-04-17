// Auth
export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthResponse extends AuthTokens {
  user: Pick<User, 'id' | 'email' | 'createdAt'>
}

export interface RefreshTokenRequest {
  refreshToken: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
}

// User
export interface User {
  id: string
  email: string
  createdAt: string
  updatedAt: string
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
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  userId: string
  name: string
  type: CategoryType
  createdAt: string
  updatedAt: string
}

/** amount is a decimal string in API JSON */
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

// Imports (CSV / OFX)
export type ImportBatchFormat = 'CSV' | 'OFX'

export interface ImportPreviewRow {
  occurredAt: string
  kind: TransactionKind
  amount: string
  description: string
  fingerprint: string
  isDuplicate: boolean
  suggestedCategoryId: string | null
}

export interface ImportPreviewResponse {
  format: ImportBatchFormat
  fileName: string
  rows: ImportPreviewRow[]
  totalParsed: number
  duplicateCount: number
  newCount: number
}

export interface CommitImportRow {
  occurredAt: string
  kind: TransactionKind
  amount: number
  description: string
  categoryId?: string
}

export interface CommitImportRequest {
  sourceId: string
  fileName: string
  format: ImportBatchFormat
  rows: CommitImportRow[]
}

export interface CommitImportResponse {
  importBatchId: string
  created: number
  skippedDuplicates: number
}

// Reports (Phase 7)
export interface ReportSummaryResponse {
  income: string
  expense: string
  net: string
}

export interface CategoryReportRow {
  categoryId: string | null
  name: string
  kind: TransactionKind
  total: string
}

export interface ReportByCategoryResponse {
  items: CategoryReportRow[]
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
