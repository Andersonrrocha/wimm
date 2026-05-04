import type { TokenStore, UpdaterApi } from '../../preload/index'

declare global {
  interface Window {
    tokenStore: TokenStore
    updater: UpdaterApi
  }
}

export {}
