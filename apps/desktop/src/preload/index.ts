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
