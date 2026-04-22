import Store from 'electron-store'

type StoreSchema = {
  accessToken?: string
  refreshToken?: string
  persistSession?: boolean
}

const store = new Store<StoreSchema>({
  name: 'wimm-session',
  encryptionKey: 'wimm-session-key',
  clearInvalidConfig: true,
})

let sessionAccess: string | undefined
let sessionRefresh: string | undefined

export function getPersistSession(): boolean {
  return store.get('persistSession', true)
}

export function getAccessToken(): string | undefined {
  if (sessionAccess !== undefined) return sessionAccess
  return store.get('accessToken')
}

export function getRefreshToken(): string | undefined {
  if (sessionRefresh !== undefined) return sessionRefresh
  return store.get('refreshToken')
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  rememberMe = true,
): void {
  store.set('persistSession', rememberMe)
  if (rememberMe) {
    sessionAccess = undefined
    sessionRefresh = undefined
    store.set('accessToken', accessToken)
    store.set('refreshToken', refreshToken)
  } else {
    sessionAccess = accessToken
    sessionRefresh = refreshToken
    store.delete('accessToken')
    store.delete('refreshToken')
  }
}

export function clearTokens(): void {
  sessionAccess = undefined
  sessionRefresh = undefined
  store.delete('accessToken')
  store.delete('refreshToken')
  store.delete('persistSession')
}
