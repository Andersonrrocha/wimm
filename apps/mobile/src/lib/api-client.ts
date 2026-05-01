import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { AuthResponse, RefreshTokenRequest } from '@wimm/shared'
import { authEvents } from './auth-events'
import { secureTokenStore } from './secure-token-store'

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api'

// Hard-fail at boot if a release build was bundled with an insecure URL.
// `__DEV__` is false in EAS/production builds; cleartext traffic is blocked
// by ATS/NetworkSecurityConfig anyway, but failing here gives a precise
// error message instead of a silent network error.
if (!__DEV__ && !API_BASE_URL.startsWith('https://')) {
  throw new Error(
    `EXPO_PUBLIC_API_URL must use HTTPS in production builds. Got: ${API_BASE_URL}`,
  )
}

let isRefreshing = false
let pendingQueue: Array<{
  resolve: (token: string) => void
  reject: (error: unknown) => void
}> = []

function drainQueue(token: string): void {
  pendingQueue.forEach((p) => p.resolve(token))
  pendingQueue = []
}

function rejectQueue(error: unknown): void {
  pendingQueue.forEach((p) => p.reject(error))
  pendingQueue = []
}

/** Do not run refresh-token flow for these calls — 401 is part of normal API semantics. */
function isPublicAuthRequest(
  config: InternalAxiosRequestConfig | undefined,
): boolean {
  const url = config?.url ?? ''
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/refresh')
  )
}

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
  })

  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      if (config.data instanceof FormData) {
        config.headers.delete('Content-Type')
      }
      const token = await secureTokenStore.getAccessToken()
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`)
      }
      return config
    },
  )

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as InternalAxiosRequestConfig & {
        _retried?: boolean
      }

      if (
        error.response?.status !== 401 ||
        original._retried ||
        isPublicAuthRequest(original)
      ) {
        return Promise.reject(error)
      }

      original._retried = true

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({
            resolve: (token) => {
              original.headers.set('Authorization', `Bearer ${token}`)
              resolve(client(original))
            },
            reject,
          })
        })
      }

      isRefreshing = true

      try {
        const refreshToken = await secureTokenStore.getRefreshToken()
        if (!refreshToken) throw new Error('No refresh token')

        const body: RefreshTokenRequest = { refreshToken }
        const { data } = await axios.post<AuthResponse>(
          `${API_BASE_URL}/auth/refresh`,
          body,
        )

        const rememberMe = await secureTokenStore.getPersistSession()
        await secureTokenStore.setTokens(
          data.accessToken,
          data.refreshToken,
          rememberMe,
        )
        drainQueue(data.accessToken)

        original.headers.set('Authorization', `Bearer ${data.accessToken}`)
        return client(original)
      } catch (refreshError) {
        rejectQueue(refreshError)
        await secureTokenStore.clearTokens()
        authEvents.emitLogout()
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    },
  )

  return client
}

export const apiClient = createApiClient()
