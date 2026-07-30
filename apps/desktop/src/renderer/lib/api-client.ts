import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { AuthResponse, RefreshTokenRequest } from '@wimm/shared'
import { resolveApiMode } from './api-mode'
import { createLocalApiAdapter } from './local-api-adapter'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

/**
 * The local-mode adapter, built once against `window.localApi` (the preload
 * bridge -- see `preload/index.ts`). Only ever *installed* on a request
 * (`config.adapter = localAdapter` below) once `resolveApiMode` has actually
 * reported `'local'` -- constructing it eagerly here is harmless (it holds
 * no state of its own until called) and keeps the interceptor below a plain
 * `if`, not a lazy-init dance.
 */
const localAdapter = createLocalApiAdapter({
  request: (config) => window.localApi.request(config),
})

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
function isPublicAuthRequest(config: InternalAxiosRequestConfig | undefined): boolean {
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

  // Attach stored access token to every request -- hosted mode only.
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (config.data instanceof FormData) {
      config.headers.delete('Content-Type')
    }

    const mode = await resolveApiMode(window.localApi)

    if (mode.mode === 'local') {
      // Route this request through the embedded API's IPC adapter instead
      // of the normal HTTP transport (see `local-api-adapter.ts`'s doc
      // comment for why: no CORS-safe way exists to call the embedded API
      // directly from the renderer without also handing it the session
      // token). There is no token store to consult here -- local mode has
      // no login flow and no token of its own -- so, unlike the hosted
      // branch below, nothing else in this interceptor applies.
      config.adapter = localAdapter
      return config
    }

    const token = await window.tokenStore.getAccessToken()
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
    return config
  })

  // On 401: try refresh once, then queue concurrent requests -- hosted mode only.
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const mode = await resolveApiMode(window.localApi)

      if (mode.mode === 'local') {
        // There is no refresh token to exchange in local mode -- identity
        // comes from `ProfileModule`'s own middleware, not a JWT this app
        // issued. A 401 here means the session token main injected was
        // rejected (a real bug: a stale token after a restart, or the guard
        // itself misbehaving), never an expired session, so this must not
        // retry, must not touch `window.tokenStore` (which local mode never
        // populates in the first place), and must not dispatch
        // `auth:logout` -- there is no login screen for it to send the user
        // to. Surfacing the rejection as-is is what lets it look like the
        // real failure it is, instead of a silently empty screen.
        return Promise.reject(error)
      }

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
