import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from '@wimm/shared'
import { applyLocale } from '../i18n/config'
import { apiClient } from '../lib/api-client'
import { authEvents } from '../lib/auth-events'
import { secureTokenStore } from '../lib/secure-token-store'

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }

interface AuthContextValue {
  state: AuthState
  login: (data: LoginRequest, rememberMe?: boolean) => Promise<void>
  register: (data: RegisterRequest, rememberMe?: boolean) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const initialized = useRef(false)

  const persistAndSetUser = useCallback(
    async (data: AuthResponse, rememberMe = true) => {
      await secureTokenStore.setTokens(
        data.accessToken,
        data.refreshToken,
        rememberMe,
      )
      const user = data.user as User
      setState({ status: 'authenticated', user })
      await applyLocale(user.preferredLocale)
    },
    [],
  )

  const clearSession = useCallback(async () => {
    await secureTokenStore.clearTokens()
    setState({ status: 'unauthenticated' })
  }, [])

  // On mount: check for an existing valid session by calling /users/me
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const restore = async (): Promise<void> => {
      const token = await secureTokenStore.getAccessToken()
      if (!token) {
        setState({ status: 'unauthenticated' })
        return
      }
      try {
        const { data } = await apiClient.get<User>('/users/me')
        setState({ status: 'authenticated', user: data })
        await applyLocale(data.preferredLocale)
      } catch {
        setState({ status: 'unauthenticated' })
      }
    }

    void restore()
  }, [])

  // Listen for forced logout triggered by the api-client refresh failure
  useEffect(() => {
    return authEvents.onLogout(() => {
      setState({ status: 'unauthenticated' })
    })
  }, [])

  const login = useCallback(
    async (body: LoginRequest, rememberMe = true) => {
      const { data } = await apiClient.post<AuthResponse>('/auth/login', body)
      await persistAndSetUser(data, rememberMe)
    },
    [persistAndSetUser],
  )

  const register = useCallback(
    async (body: RegisterRequest, rememberMe = true) => {
      const { data } = await apiClient.post<AuthResponse>(
        '/auth/register',
        body,
      )
      await persistAndSetUser(data, rememberMe)
    },
    [persistAndSetUser],
  )

  const logout = useCallback(async () => {
    await clearSession()
  }, [clearSession])

  const refreshUser = useCallback(async () => {
    const token = await secureTokenStore.getAccessToken()
    if (!token) return
    const { data } = await apiClient.get<User>('/users/me')
    setState({ status: 'authenticated', user: data })
    await applyLocale(data.preferredLocale)
  }, [])

  return (
    <AuthContext.Provider
      value={{ state, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
