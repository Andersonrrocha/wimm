import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiMode,
  LocalApiRequestPayload,
  LocalApiResponsePayload,
} from '../shared/local-api-protocol'
import type { ProfilesSituationPayload } from '../shared/profile-protocol'

export type TokenStore = {
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

const tokenStore: TokenStore = {
  getAccessToken: () => ipcRenderer.invoke('tokens:getAccess'),
  getRefreshToken: () => ipcRenderer.invoke('tokens:getRefresh'),
  getPersistSession: () => ipcRenderer.invoke('tokens:getPersistSession'),
  setTokens: (accessToken, refreshToken, rememberMe = true) =>
    ipcRenderer.invoke('tokens:set', accessToken, refreshToken, rememberMe),
  clearTokens: () => ipcRenderer.invoke('tokens:clear'),
}

contextBridge.exposeInMainWorld('tokenStore', tokenStore)

export type UpdateInfo = { version: string }
export type DownloadProgress = { percent: number }
export type UpdateError = { message: string }

export type UpdaterApi = {
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void
  onDownloadProgress: (cb: (progress: DownloadProgress) => void) => () => void
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => () => void
  onUpdateError: (cb: (err: UpdateError) => void) => () => void
  quitAndInstall: () => Promise<void>
}

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const updater: UpdaterApi = {
  onUpdateAvailable: (cb) => listen<UpdateInfo>('updater:available', cb),
  onDownloadProgress: (cb) =>
    listen<DownloadProgress>('updater:download-progress', cb),
  onUpdateDownloaded: (cb) => listen<UpdateInfo>('updater:downloaded', cb),
  onUpdateError: (cb) => listen<UpdateError>('updater:error', cb),
  quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
}

contextBridge.exposeInMainWorld('updater', updater)

/**
 * The renderer's only way to reach the embedded local API. Deliberately
 * exposes just two operations, neither of which ever hands the renderer a
 * session token:
 *
 * - `getMode` reports whether main booted the embedded API at all --
 *   `api-client.ts` uses this, via `api-mode.ts`, to decide once (and only
 *   once) whether to install the local IPC adapter or leave the existing
 *   hosted HTTP path untouched.
 * - `request` is the transport itself: `local-api-adapter.ts` hands it a
 *   method/path/data/params/headers tuple with no credential in it at all,
 *   and `index.ts`'s `local-api:request` handler (via
 *   `forwardLocalApiRequest`, `main/local-api-bridge.ts`) attaches the real,
 *   per-launch session token in main before the request ever leaves the
 *   process. See that module's doc comment for why this boundary is the
 *   whole point of this design: the renderer -- and therefore any XSS or
 *   compromised dependency running inside it -- never receives, stores, or
 *   forwards the token, because it is never handed one.
 */
export type LocalApi = {
  getMode: () => Promise<ApiMode>
  request: (config: LocalApiRequestPayload) => Promise<LocalApiResponsePayload>
}

const localApi: LocalApi = {
  getMode: () => ipcRenderer.invoke('local-api:get-mode'),
  request: (config: LocalApiRequestPayload) => ipcRenderer.invoke('local-api:request', config),
}

contextBridge.exposeInMainWorld('localApi', localApi)

/**
 * The renderer's only way to find out about, create, or open a local
 * profile -- see `profile-protocol.ts` for the wire shapes and
 * `main/index.ts`'s `profiles:*` handlers for what main actually validates
 * before acting on `create`/`open`. This bridge does no validation itself
 * (nor does anything else under `preload/`): it only relays the call across
 * `contextBridge`, exactly like `localApi.request` above -- the renderer is
 * the untrusted side of this boundary, so every real check happens in main.
 */
export type ProfilesApi = {
  getSituation: () => Promise<ProfilesSituationPayload>
  create: (name: string) => Promise<ProfilesSituationPayload>
  open: (id: string) => Promise<ProfilesSituationPayload>
}

const profiles: ProfilesApi = {
  getSituation: () => ipcRenderer.invoke('profiles:get-situation'),
  create: (name: string) => ipcRenderer.invoke('profiles:create', name),
  open: (id: string) => ipcRenderer.invoke('profiles:open', id),
}

contextBridge.exposeInMainWorld('profiles', profiles)
