import * as SecureStore from 'expo-secure-store'

/**
 * Mirrors the desktop's `window.tokenStore` (preload/index.ts) so the
 * api-client can be ported without conditionals. Tokens persist in
 * iOS Keychain / Android Keystore via `expo-secure-store`.
 *
 * `rememberMe = false`: tokens stay in process memory only; killing the
 * app forces a re-login. Matches the desktop behaviour.
 */
export interface TokenStore {
  getAccessToken: () => Promise<string | undefined>
  getRefreshToken: () => Promise<string | undefined>
  getPersistSession: () => Promise<boolean>
  setTokens: (
    accessToken: string,
    refreshToken: string,
    rememberMe?: boolean,
  ) => Promise<void>
  clearTokens: () => Promise<void>
}

const ACCESS_KEY = 'wimm_access_token'
const REFRESH_KEY = 'wimm_refresh_token'
const PERSIST_KEY = 'wimm_persist_session'

let sessionAccess: string | undefined
let sessionRefresh: string | undefined

async function readSecure(key: string): Promise<string | undefined> {
  const value = await SecureStore.getItemAsync(key)
  return value ?? undefined
}

export const secureTokenStore: TokenStore = {
  async getAccessToken() {
    if (sessionAccess !== undefined) return sessionAccess
    return readSecure(ACCESS_KEY)
  },
  async getRefreshToken() {
    if (sessionRefresh !== undefined) return sessionRefresh
    return readSecure(REFRESH_KEY)
  },
  async getPersistSession() {
    const value = await readSecure(PERSIST_KEY)
    if (value === undefined) return true
    return value === '1'
  },
  async setTokens(accessToken, refreshToken, rememberMe = true) {
    await SecureStore.setItemAsync(PERSIST_KEY, rememberMe ? '1' : '0')
    if (rememberMe) {
      sessionAccess = undefined
      sessionRefresh = undefined
      await SecureStore.setItemAsync(ACCESS_KEY, accessToken)
      await SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
    } else {
      sessionAccess = accessToken
      sessionRefresh = refreshToken
      await SecureStore.deleteItemAsync(ACCESS_KEY)
      await SecureStore.deleteItemAsync(REFRESH_KEY)
    }
  },
  async clearTokens() {
    sessionAccess = undefined
    sessionRefresh = undefined
    await SecureStore.deleteItemAsync(ACCESS_KEY)
    await SecureStore.deleteItemAsync(REFRESH_KEY)
    await SecureStore.deleteItemAsync(PERSIST_KEY)
  },
}
