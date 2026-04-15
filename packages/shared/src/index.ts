// Auth
export interface AuthTokens {
  accessToken: string
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
