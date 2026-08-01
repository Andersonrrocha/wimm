import type { BackupsApi, LocalApi, ProfilesApi, TokenStore, UpdaterApi } from '../../preload/index'

declare global {
  interface Window {
    tokenStore: TokenStore
    updater: UpdaterApi
    localApi: LocalApi
    profiles: ProfilesApi
    backups: BackupsApi
  }
}

export {}
