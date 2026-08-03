import { contextBridge, ipcRenderer } from 'electron'
import type { ExportResult, ProfileBackups } from '../shared/backup-protocol'
import type {
  ApiMode,
  LocalApiRequestPayload,
  LocalApiResponsePayload,
} from '../shared/local-api-protocol'
import type { ProfileSummary, ProfilesSituationPayload } from '../shared/profile-protocol'
import type {
  CsvMapping,
  CsvMappingApplyResult,
  CsvMappingProposal,
} from '../shared/csv-mapping-protocol'

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
  /**
   * Every registered profile, regardless of which one (if any) is
   * currently open -- Phase 4c task 3's switcher UI uses this to show what
   * the user can switch to. Unlike `getSituation`, this is meaningful only
   * once a profile is already open (there is nothing to switch away from
   * otherwise); main does not gate on that itself, since `listProfiles`
   * behaves the same regardless.
   */
  list: () => Promise<ProfileSummary[]>
  /**
   * Tears the currently open profile down and boots `id` in its place. See
   * `main/local-api.ts`'s `switchProfile` for the teardown-then-rebuild
   * contract and its rollback behaviour on failure, and `main/index.ts`'s
   * `profiles:switch` handler for how a failure is turned into a rejected
   * promise here -- main has already attempted to land on a working profile
   * (the original one, if reopening it succeeded) by the time this rejects.
   */
  switch: (id: string) => Promise<ProfilesSituationPayload>
}

const profiles: ProfilesApi = {
  getSituation: () => ipcRenderer.invoke('profiles:get-situation'),
  create: (name: string) => ipcRenderer.invoke('profiles:create', name),
  open: (id: string) => ipcRenderer.invoke('profiles:open', id),
  list: () => ipcRenderer.invoke('profiles:list'),
  switch: (id: string) => ipcRenderer.invoke('profiles:switch', id),
}

contextBridge.exposeInMainWorld('profiles', profiles)

/**
 * The renderer's only way to reach export/restore (Phase 4c task 4) -- see
 * `backup-protocol.ts` for the wire shapes and `main/index.ts`'s
 * `backups:*` handlers for what main actually validates before acting. No
 * validation happens here, same as every other bridge in this file: the
 * renderer is the untrusted side of this boundary.
 */
export type BackupsApi = {
  /** Lists `profileId`'s own backups -- not necessarily the currently active profile, see `main/local-api.ts`'s `restoreProfileFromBackup` doc comment. */
  list: (profileId: string) => Promise<ProfileBackups>
  /** Opens a native save dialog and, unless canceled, copies the ACTIVE profile's database to wherever the user chose. */
  export: () => Promise<ExportResult>
  /** Restores `profileId` from one of its own backups, named by `fileName` exactly as `list` reported it. */
  restore: (profileId: string, fileName: string) => Promise<ProfilesSituationPayload>
}

const backups: BackupsApi = {
  list: (profileId: string) => ipcRenderer.invoke('backups:list', profileId),
  export: () => ipcRenderer.invoke('backups:export'),
  restore: (profileId: string, fileName: string) =>
    ipcRenderer.invoke('backups:restore', { profileId, fileName }),
}

contextBridge.exposeInMainWorld('backups', backups)

/**
 * The renderer's only way to reach the CSV column-mapping detection/apply
 * functions (Stage 2 task 5) -- see `csv-mapping-protocol.ts` for the wire
 * shapes and `main/csv-mapping-bridge.ts`/`main/index.ts`'s `csv-mapping:*`
 * handlers for what main actually validates before running them. No
 * validation happens here, same as every other bridge in this file: the
 * renderer is the untrusted side of this boundary. Neither operation reads
 * or writes anything persisted -- `propose` only inspects the bytes handed
 * to it, and `apply` is the live preview for a mapping the user has not
 * saved yet; saving happens through the existing `GET`/`PUT
 * /imports/csv-mapping/:sourceId` HTTP routes, reached the normal way
 * through `apiClient` and `localApi.request` above, not through this
 * bridge.
 */
export type CsvMappingApi = {
  /** Proposes a mapping for `fileBytes`, each field carrying its own confidence and reason. */
  propose: (fileBytes: Uint8Array) => Promise<CsvMappingProposal>
  /** Applies `mapping` (still unconfirmed) to `fileBytes`, for the live preview. */
  apply: (
    fileBytes: Uint8Array,
    mapping: CsvMapping,
  ) => Promise<CsvMappingApplyResult>
}

const csvMapping: CsvMappingApi = {
  propose: (fileBytes: Uint8Array) =>
    ipcRenderer.invoke('csv-mapping:propose', fileBytes),
  apply: (fileBytes: Uint8Array, mapping: CsvMapping) =>
    ipcRenderer.invoke('csv-mapping:apply', fileBytes, mapping),
}

contextBridge.exposeInMainWorld('csvMapping', csvMapping)
