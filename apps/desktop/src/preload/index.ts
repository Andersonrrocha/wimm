import { contextBridge, ipcRenderer } from 'electron'

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
