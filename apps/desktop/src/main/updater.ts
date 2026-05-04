import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires electron-updater against the GitHub Releases provider configured in
 * package.json. Sends progress events to the renderer so a toast can surface
 * updates without interrupting work.
 *
 * No-ops in dev (electron-updater refuses to run unpackaged).
 */
export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload: unknown): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  autoUpdater.on('update-available', (info) => {
    send('updater:available', { version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    send('updater:not-available', null)
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:download-progress', { percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send('updater:error', { message: err?.message ?? 'unknown' })
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* swallowed: surfaced via 'error' event above */
  })
}

export function quitAndInstallUpdate(): void {
  autoUpdater.quitAndInstall()
}
