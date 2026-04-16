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
  kind: TransactionKind
  amount: string
  description: string
  occurredAt: string
  fingerprint: string | null
  createdAt: string
  updatedAt: string
}
