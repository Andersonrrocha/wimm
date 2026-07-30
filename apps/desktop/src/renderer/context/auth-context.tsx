import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { AxiosError } from 'axios'
import type { AuthResponse, LoginRequest, RegisterRequest, User } from '@wimm/shared'
import { applyLocale, getGuestLocale } from '../i18n/config'
import { apiClient } from '../lib/api-client'
import { resolveApiMode, type ApiMode } from '../lib/api-mode'

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }
  // Local mode only: `/users/me` failed against the embedded API. This is
  // deliberately NOT `unauthenticated` -- see this module's doc comment on
  // `restore` for why collapsing the two would strand the user on a login
  // screen with no way to satisfy it. `detail` is whatever
  // `describeLocalBackendError` could extract from the failure, shown
  // as-is so a real report can be filed against it.
  | { status: 'local-backend-error'; detail: string }

type AuthContextValue = {
  state: AuthState
  /**
   * Resolved once per renderer session (see `resolveApiMode`), `null` until
   * that resolves. Exposed here -- not just consumed internally -- so
   * routes that make no sense at all in local mode (`/login`, `/register`:
   * there are no accounts to sign into or create) can redirect away
   * regardless of `state`, instead of only guarding on authentication
   * status.
   */
  mode: ApiMode | null
  login: (data: LoginRequest, rememberMe?: boolean) => Promise<void>
  register: (data: RegisterRequest, rememberMe?: boolean) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Extracts a short, reportable description of why `/users/me` failed in
 * local mode -- an HTTP status plus whatever message the embedded API sent
 * (a NestJS default body's `message`, e.g. "Unauthorized" or "Cannot GET
 * /api/xyz/users/me"), falling back to the raw error's own message for
 * anything that never reached the HTTP layer at all (e.g. the IPC bridge
 * itself throwing because no embedded API is running). Never empty --
 * always returns *something* a user could paste into a bug report.
 */
function describeLocalBackendError(err: unknown): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status
    const body = err.response?.data as { message?: string | string[] } | undefined
    const rawMessage = body?.message
    const message = Array.isArray(rawMessage) ? rawMessage.join(' ') : rawMessage
    if (status !== undefined) {
      return message ? `HTTP ${status}: ${message}` : `HTTP ${status}`
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [mode, setMode] = useState<ApiMode | null>(null)
  const initialized = useRef(false)

  const persistAndSetUser = useCallback(
    async (data: AuthResponse, rememberMe = true) => {
      await window.tokenStore.setTokens(
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
    await window.tokenStore.clearTokens()
    setState({ status: 'unauthenticated' })
    await applyLocale(getGuestLocale())
  }, [])

  // On mount: check for an existing valid session by calling /users/me
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const restore = async (): Promise<void> => {
      const resolvedMode = await resolveApiMode(window.localApi)
      setMode(resolvedMode)

      // Local mode has no login flow and therefore no access token to look
      // for: there is nothing in `window.tokenStore` to check, ever, since
      // nothing in local mode ever calls `setTokens`. Identity there comes
      // from the profile's single `User` row, admitted once the embedded
      // API's session-token guard accepts the request (see
      // `SessionTokenGuard` and `ProfileModule`'s middleware) -- so the
      // equivalent "is there a session" check is simply asking `/users/me`
      // directly, with no token gate in front of it.
      //
      // A failure here must NOT degrade to `unauthenticated`: local mode has
      // no accounts, so "unauthenticated" renders a login screen the user
      // can never satisfy (no credentials exist, registering isn't a local
      // concept, and the embedded API would reject the attempt too). That
      // is a dead end, not a graceful fallback -- proven the hard way in
      // this task's first round, where two entirely different failures
      // (a missing token; a broken path prefix) both rendered the identical,
      // actionless login form. `local-backend-error` exists so this failure
      // is instead visibly, distinguishably its own thing.
      if (resolvedMode.mode === 'local') {
        try {
          const { data } = await apiClient.get<User>('/users/me')
          setState({ status: 'authenticated', user: data })
          await applyLocale(data.preferredLocale)
        } catch (err) {
          setState({ status: 'local-backend-error', detail: describeLocalBackendError(err) })
          // Deliberately no `applyLocale(getGuestLocale())` here: that call
          // is what `unauthenticated` uses to reset to a guest-facing
          // locale for the login screen, which this state never shows.
        }
        return
      }

      const token = await window.tokenStore.getAccessToken()
      if (!token) {
        setState({ status: 'unauthenticated' })
        await applyLocale(getGuestLocale())
        return
      }
      try {
        const { data } = await apiClient.get<User>('/users/me')
        setState({ status: 'authenticated', user: data })
        await applyLocale(data.preferredLocale)
      } catch {
        setState({ status: 'unauthenticated' })
        await applyLocale(getGuestLocale())
      }
    }

    void restore()
  }, [])

  // Listen for forced logout triggered by the api-client refresh failure
  useEffect(() => {
    const handler = (): void => {
      setState({ status: 'unauthenticated' })
      void applyLocale(getGuestLocale())
    }
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
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
      const { data } = await apiClient.post<AuthResponse>('/auth/register', body)
      await persistAndSetUser(data, rememberMe)
    },
    [persistAndSetUser],
  )

  const logout = useCallback(async () => {
    if (mode?.mode === 'local') {
      // Local mode has no session to end: one profile, one always-admitted
      // user, no account switcher yet (Phase 4c owns that). Transitioning
      // to `unauthenticated` here would be the same dead end this task's
      // report flags for `/login` -- a login form with no way to satisfy
      // it -- so this is a deliberate no-op instead of a real sign-out,
      // until Phase 4c gives "sign out" something real to do in local mode
      // (e.g. closing this profile to return to a picker).
      return
    }
    await clearSession()
  }, [clearSession, mode])

  const refreshUser = useCallback(async () => {
    // Same token-store gate `restore` uses, and the same reason it needs a
    // local-mode branch: `window.tokenStore` never holds anything in local
    // mode, so the hosted-mode early return below (`if (!token) return`)
    // would silently no-op here forever -- including right after
    // onboarding finishes (`onboarding-page.tsx` calls this to pick up the
    // freshly-set `onboardedAt`), which would otherwise strand a fresh
    // local profile on the onboarding screen permanently.
    if (mode?.mode === 'local') {
      try {
        const { data } = await apiClient.get<User>('/users/me')
        setState({ status: 'authenticated', user: data })
        await applyLocale(data.preferredLocale)
      } catch (err) {
        setState({ status: 'local-backend-error', detail: describeLocalBackendError(err) })
      }
      return
    }

    const token = await window.tokenStore.getAccessToken()
    if (!token) return
    const { data } = await apiClient.get<User>('/users/me')
    setState({ status: 'authenticated', user: data })
    await applyLocale(data.preferredLocale)
  }, [mode])

  return (
    <AuthContext.Provider
      value={{ state, mode, login, register, logout, refreshUser }}
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
