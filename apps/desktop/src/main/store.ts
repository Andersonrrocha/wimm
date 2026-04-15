import Store from 'electron-store'

type StoreSchema = {
  accessToken: string
  refreshToken: string
}

const store = new Store<StoreSchema>({
  name: 'wimm-session',
  encryptionKey: 'wimm-session-key',
  clearInvalidConfig: true,
})

export function getAccessToken(): string | undefined {
  return store.get('accessToken')
}

export function getRefreshToken(): string | undefined {
  return store.get('refreshToken')
}

export function setTokens(accessToken: string, refreshToken: string): void {
  store.set('accessToken', accessToken)
  store.set('refreshToken', refreshToken)
}

export function clearTokens(): void {
  store.delete('accessToken')
  store.delete('refreshToken')
}
