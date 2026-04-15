import { contextBridge } from 'electron'

// Expose a typed API surface to the renderer process via window.api
// This will be expanded in Phase 3 with auth token storage helpers.
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
})
