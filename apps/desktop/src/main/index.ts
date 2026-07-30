import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import {
  clearTokens,
  getAccessToken,
  getPersistSession,
  getRefreshToken,
  setTokens,
} from './store'
import { NewerDatabaseError, startLocalApi, type LocalApiHandle } from './local-api'
import { forwardLocalApiRequest } from './local-api-bridge'
import { quitAndInstallUpdate, setupAutoUpdater } from './updater'
import type { ApiMode, LocalApiRequestPayload } from '../shared/local-api-protocol'

let mainWindow: BrowserWindow | null = null

/**
 * The embedded local API's handle for this launch, once booted -- `port`
 * and `token` are what Task 3's IPC handshake hands the renderer, and
 * `close()` is what tears the HTTP server and the Prisma connection down on
 * quit (see the `before-quit` handler below). `undefined` until
 * `bootLocalApi` resolves, and again after a successful shutdown, so that
 * handler never double-closes.
 */
let localApiHandle: LocalApiHandle | undefined

// --- Single-instance lock -------------------------------------------------
//
// Two instances booting against the same profile would both open the same
// SQLite file and both run the migration runner concurrently -- the second
// one used to roll back cleanly but blame the *migration*, rather than
// saying plainly that the app is already running. `requestSingleInstanceLock`
// is called as the very first thing in this file, before `app.whenReady()`
// or anything that touches a profile, specifically so a second launch never
// reaches `startLocalApi()` (and therefore never opens a database file or
// runs a migration) at all -- it just quits, letting the first instance's
// `second-instance` handler below bring the existing window forward instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  runApp()
}

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

  // --- Embedded local API handshake ---------------------------------------
  //
  // Registered unconditionally, before `bootLocalApi` has necessarily run --
  // `localApiHandle` is read at *call* time (a closure over the module-level
  // variable), not captured here, so these two handlers always report
  // whatever is actually true at the moment the renderer asks, not whatever
  // was true when the app started listening.
  //
  // `local-api:get-mode` is the renderer's only way to learn which transport
  // to use (see `api-client.ts`'s `resolveApiMode`) -- never an env var it
  // reads itself. `local-api:request` is the renderer's only way to reach
  // the embedded API at all: it forwards to `forwardLocalApiRequest`
  // (`local-api-bridge.ts`), which attaches the real session token here, in
  // main, so the renderer never receives it. See that module's doc comment
  // for the full reasoning.
  ipcMain.handle('local-api:get-mode', (): ApiMode => {
    return localApiHandle ? { mode: 'local' } : { mode: 'hosted' }
  })

  ipcMain.handle('local-api:request', (_event, payload: LocalApiRequestPayload) => {
    if (!localApiHandle) {
      // The renderer only calls this after `local-api:get-mode` reported
      // `'local'`, which only happens once `localApiHandle` is set -- this
      // can only be reached by a caller ignoring that contract, not by any
      // path this app's own renderer code takes. Refusing loudly here
      // beats returning a confusing network-level error from a `fetch` to
      // a port that no longer means anything.
      throw new Error(
        'local-api:request invoked with no embedded local API running -- the renderer must check ' +
          "local-api:get-mode's result before calling this.",
      )
    }
    return forwardLocalApiRequest(localApiHandle, payload)
  })
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

/**
 * Boots the embedded local API before any window is created. A failure here
 * means the user's profile could not be opened -- showing an empty or
 * hosted-looking window on top of that would hide a real problem, so this
 * shows a blocking, native dialog naming what happened and quits instead.
 *
 * `NewerDatabaseError` (see `local-api.ts`) gets a specific, actionable
 * message: the profile was migrated by a build newer than this one, and the
 * only way back is reinstalling that newer build, or restoring a snapshot
 * taken *before* the upgrade to it (never this database as it is now -- see
 * `migration-runner.ts`'s own doc comment for why). Every other failure
 * (a corrupt registry, a checksum mismatch, ...) gets a generic-but-honest
 * dialog instead of a raw stack trace, still naming the underlying message
 * so it can be reported.
 */
async function bootLocalApi(): Promise<LocalApiHandle | undefined> {
  const profileDir = join(app.getPath('userData'), 'profiles')

  try {
    return await startLocalApi({ profileDir })
  } catch (err) {
    if (err instanceof NewerDatabaseError) {
      dialog.showErrorBox(
        'This profile was created by a newer version of Wimm',
        `${err.message}\n\nWimm cannot open this profile with the version currently installed. Reinstall the ` +
          'newer version, or restore a backup snapshot taken BEFORE you last upgraded (not this database as it ' +
          'is now).',
      )
    } else {
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox(
        'Wimm could not open your profile',
        `Something went wrong while starting Wimm's local database:\n\n${message}`,
      )
    }
    return undefined
  }
}

async function runApp(): Promise<void> {
  await app.whenReady()

  registerIpcHandlers()

  localApiHandle = await bootLocalApi()
  if (!localApiHandle) {
    // bootLocalApi already told the user what happened -- nothing left to
    // do but quit rather than open a window with no working backend.
    app.quit()
    return
  }

  createWindow()
  setupAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

// --- Teardown --------------------------------------------------------------
//
// `close()` is async (it disconnects Prisma -- see LocalPrismaService's
// onModuleDestroy), but Electron's 'before-quit' does not wait for an async
// handler on its own. Without `preventDefault()` here, the process could
// exit mid-disconnect, leaking the SQLite handle -- which would in turn
// break `restoreSnapshot` (it now refuses when it cannot get exclusive
// access, see snapshot.ts) and block the profile switch Phase 4c needs. So
// this defers the actual quit until `close()` has resolved, then calls
// `app.quit()` again -- `isQuitting` guards against re-entering this handler
// on that second call.
let isQuitting = false

app.on('before-quit', (event) => {
  if (isQuitting || !localApiHandle) return

  event.preventDefault()
  isQuitting = true

  const handle = localApiHandle
  localApiHandle = undefined

  handle
    .close()
    .catch((err) => {
      console.error('startLocalApi: failed to close cleanly on quit:', err)
    })
    .finally(() => {
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
