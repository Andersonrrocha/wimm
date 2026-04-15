import type { TokenStore } from '../../preload/index'

declare global {
  interface Window {
    tokenStore: TokenStore
  }
}

export {}
