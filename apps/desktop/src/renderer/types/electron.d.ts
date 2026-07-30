import type { LocalApi, TokenStore, UpdaterApi } from '../../preload/index'

declare global {
  interface Window {
    tokenStore: TokenStore
    updater: UpdaterApi
    localApi: LocalApi
  }
}

export {}
