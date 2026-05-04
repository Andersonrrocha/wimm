import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import {
  clearTokens,
  getAccessToken,
  getPersistSession,
  getRefreshToken,
  setTokens,
} from './store'
import { quitAndInstallUpdate, setupAutoUpdater } from './updater'

let mainWindow: BrowserWindow | null = null

function registerIpcHandlers(): void {
  ipcMain.handle('tokens:getAccess', () => getAccessToken())
  ipcMain.handle('tokens:getRefresh', () => getRefreshToken())
  ipcMain.handle('tokens:getPersistSession', () => getPersistSession())
  ipcMain.handle(
    'tokens:set',
    (_event, access: string, refresh: string, rememberMe?: boolean) =>
      setTokens(access, refresh, rememberMe !== false),
  )
  ipcMain.handle('tokens:clear', () => clearTokens())
  ipcMain.handle('updater:quitAndInstall', () => quitAndInstallUpdate())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // In dev, electron-vite injects ELECTRON_RENDERER_URL
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  setupAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
