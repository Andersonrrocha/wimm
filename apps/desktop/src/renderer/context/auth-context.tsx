import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { AuthResponse, LoginRequest, RegisterRequest, User } from '@wimm/shared'
import { apiClient } from '../lib/api-client'

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }

type AuthContextValue = {
  state: AuthState
  login: (data: LoginRequest) => Promise<void>
  register: (data: RegisterRequest) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const initialized = useRef(false)

  const persistAndSetUser = useCallback(async (data: AuthResponse) => {
    await window.tokenStore.setTokens(data.accessToken, data.refreshToken)
    setState({ status: 'authenticated', user: data.user as User })
  }, [])

  const clearSession = useCallback(async () => {
    await window.tokenStore.clearTokens()
    setState({ status: 'unauthenticated' })
  }, [])

  // On mount: check for an existing valid session by calling /users/me
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const restore = async (): Promise<void> => {
      const token = await window.tokenStore.getAccessToken()
      if (!token) {
        setState({ status: 'unauthenticated' })
        return
      }
      try {
        const { data } = await apiClient.get<User>('/users/me')
        setState({ status: 'authenticated', user: data })
      } catch {
        setState({ status: 'unauthenticated' })
      }
    }

    void restore()
  }, [])

  // Listen for forced logout triggered by the api-client refresh failure
  useEffect(() => {
    const handler = (): void => {
      setState({ status: 'unauthenticated' })
    }
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [])

  const login = useCallback(
    async (body: LoginRequest) => {
      const { data } = await apiClient.post<AuthResponse>('/auth/login', body)
      await persistAndSetUser(data)
    },
    [persistAndSetUser],
  )

  const register = useCallback(
    async (body: RegisterRequest) => {
      const { data } = await apiClient.post<AuthResponse>('/auth/register', body)
      await persistAndSetUser(data)
    },
    [persistAndSetUser],
  )

  const logout = useCallback(async () => {
    await clearSession()
  }, [clearSession])

  return (
    <AuthContext.Provider value={{ state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
