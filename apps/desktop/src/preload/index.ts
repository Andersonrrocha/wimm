import { contextBridge, ipcRenderer } from 'electron'

export type TokenStore = {
  getAccessToken: () => Promise<string | undefined>
  getRefreshToken: () => Promise<string | undefined>
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>
  clearTokens: () => Promise<void>
}

const tokenStore: TokenStore = {
  getAccessToken: () => ipcRenderer.invoke('tokens:getAccess'),
  getRefreshToken: () => ipcRenderer.invoke('tokens:getRefresh'),
  setTokens: (accessToken, refreshToken) =>
    ipcRenderer.invoke('tokens:set', accessToken, refreshToken),
  clearTokens: () => ipcRenderer.invoke('tokens:clear'),
}

contextBridge.exposeInMainWorld('tokenStore', tokenStore)
