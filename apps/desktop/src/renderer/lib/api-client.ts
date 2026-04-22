import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { AuthResponse, RefreshTokenRequest } from '@wimm/shared'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

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

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
  })

  // Attach stored access token to every request
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (config.data instanceof FormData) {
      config.headers.delete('Content-Type')
    }
    const token = await window.tokenStore.getAccessToken()
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
    return config
  })

  // On 401: try refresh once, then queue concurrent requests
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as InternalAxiosRequestConfig & {
        _retried?: boolean
      }

      if (error.response?.status !== 401 || original._retried) {
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
        const refreshToken = await window.tokenStore.getRefreshToken()
        if (!refreshToken) throw new Error('No refresh token')

        const body: RefreshTokenRequest = { refreshToken }
        const { data } = await axios.post<AuthResponse>(
          `${API_BASE_URL}/auth/refresh`,
          body,
        )

        const rememberMe = await window.tokenStore.getPersistSession()
        await window.tokenStore.setTokens(
          data.accessToken,
          data.refreshToken,
          rememberMe,
        )
        drainQueue(data.accessToken)

        original.headers.set('Authorization', `Bearer ${data.accessToken}`)
        return client(original)
      } catch (refreshError) {
        rejectQueue(refreshError)
        await window.tokenStore.clearTokens()
        window.dispatchEvent(new CustomEvent('auth:logout'))
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    },
  )

  return client
}

export const apiClient = createApiClient()
