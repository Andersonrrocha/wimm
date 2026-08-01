import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { Profile } from '@wimm/api/dist/prisma/local/profile-registry'
import {
  clearTokens,
  getAccessToken,
  getPersistSession,
  getRefreshToken,
  setTokens,
} from './store'
import { createProfileAndOpen, NewerDatabaseError, openProfile, type LocalApiHandle } from './local-api'
import { forwardLocalApiRequest } from './local-api-bridge'
import { resolveProfileSituation, type ProfileSituation } from './profile-lifecycle'
import { quitAndInstallUpdate, setupAutoUpdater } from './updater'
import type { ApiMode, LocalApiRequestPayload } from '../shared/local-api-protocol'
import type { ProfileSummary, ProfilesSituationPayload } from '../shared/profile-protocol'

let mainWindow: BrowserWindow | null = null

// --- Renderer origin allowlist ---------------------------------------------
//
// Findings 2 and 3 of the phase 4b security review both reduce to the same
// question: "is this actually our own renderer?" -- Finding 2 asks it of a
// top-level navigation attempt, Finding 3 asks it of an IPC sender. Both
// need the same answer, computed the same way, so it lives here once.
//
// In dev, electron-vite injects `ELECTRON_RENDERER_URL` (the Vite dev
// server's origin, e.g. `http://localhost:5173`) -- see `createWindow`
// below, which loads exactly that URL. In a packaged build there is no dev
// server; the renderer is loaded from this build's own `index.html` on
// disk, via `loadFile`, which Electron resolves to a `file://` URL itself.
// `RENDERER_INDEX_FILE_URL` is computed with `pathToFileURL` (never
// string concatenation) so this matches byte-for-byte on every platform,
// including Windows, where a naive `file://${path}` would mishandle the
// drive letter and backslashes.
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const RENDERER_INDEX_PATH = join(__dirname, '../renderer/index.html')
const RENDERER_INDEX_FILE_URL = pathToFileURL(RENDERER_INDEX_PATH).href

/**
 * True only when `url` is exactly this app's own renderer location: the dev
 * server's origin in development (an origin match, since Vite serves more
 * than one path under it), or this build's own packaged `index.html` file in
 * production (an exact match, since nothing else this app ever loads is a
 * legitimate navigation target).
 *
 * Used both to decide whether a top-level navigation should be allowed
 * (Finding 2's `will-navigate` guard, below) and whether an IPC message
 * actually came from the app's own top-level frame (Finding 3's
 * `assertTrustedSender`, below) -- a compromised or navigated-away renderer
 * answers `false` to both.
 */
function isAppOwnUrl(url: string): boolean {
  if (RENDERER_DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(RENDERER_DEV_SERVER_URL).origin
    } catch {
      return false
    }
  }
  return url === RENDERER_INDEX_FILE_URL
}

/**
 * Finding 3 of the phase 4b security review: `local-api:request` and every
 * `tokens:*` handler trusted any sender at all. `event.senderFrame` is the
 * `WebFrameMain` that actually invoked this handler -- checking it against
 * `frame.top` rejects a call from a nested frame (an `<iframe>` this app
 * never intentionally embeds, but nothing before this stopped one from
 * calling these handlers if it existed), and checking its `.url` against
 * `isAppOwnUrl` rejects a call from a frame that navigated somewhere else
 * first (Finding 2's own attack, if it were ever to succeed despite the
 * `will-navigate` guard -- defense in depth, not a substitute for it).
 *
 * `event.senderFrame` can be `null` if the originating frame has already
 * been destroyed by the time this runs; treated as untrusted, the same as
 * any other failed check.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== frame.top) {
    return false
  }
  return isAppOwnUrl(frame.url)
}

/** Throws unless `isTrustedSender(event)` -- see that function's doc comment. */
function assertTrustedSender(event: IpcMainInvokeEvent, channel: string): void {
  if (!isTrustedSender(event)) {
    throw new Error(
      `${channel}: rejected -- this request did not originate from the app's own top-level renderer frame.`,
    )
  }
}

/**
 * The embedded local API's handle for this launch, once booted -- `port`
 * and `token` are what the IPC handshake hands the renderer, and `close()`
 * is what tears the HTTP server and the Prisma connection down on quit (see
 * the `before-quit` handler below). `undefined` until a profile is actually
 * opened (either automatically, for the single-profile case, or via
 * `profiles:create`/`profiles:open` once the user acts on the onboarding
 * or picker screen -- see `runApp` and `registerIpcHandlers` below), and
 * again after a successful shutdown, so that handler never double-closes.
 */
let localApiHandle: LocalApiHandle | undefined

/**
 * Set by `runApp` once (`app.getPath('userData')` is not available before
 * `app.whenReady()`), then read by the `profiles:create`/`profiles:open`
 * handlers below. Every profile-lifecycle operation in this file uses this
 * one value -- there is exactly one profiles directory for the life of the
 * process.
 */
let profileDir: string

/**
 * The zero/multiple-profiles situation `runApp` found at startup, kept only
 * long enough for the renderer's onboarding or picker screen to resolve it
 * via `profiles:create`/`profiles:open`. `undefined` once `localApiHandle`
 * is set (a profile is open) -- `profiles:get-situation` checks
 * `localApiHandle` first for exactly that reason, so a stale situation here
 * can never be reported once a profile is actually running.
 *
 * Deliberately typed to exclude `'single-profile'` and `'corrupt-registry'`:
 * `runApp` resolves both of those itself, before `createWindow()` ever runs
 * (opening the profile directly, or showing a dialog and quitting), so
 * neither can ever reach the renderer -- see `runApp`'s own doc comment.
 */
let pendingProfileSituation: Extract<ProfileSituation, { kind: 'no-profiles' | 'multiple-profiles' }> | undefined

/** Strips `dbFileName` before a `Profile` crosses into the renderer -- see `profile-protocol.ts`'s doc comment for why. */
function toProfileSummary(profile: Profile): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    lastOpenedAt: profile.lastOpenedAt,
  }
}

// --- Single-instance lock -------------------------------------------------
//
// Two instances booting against the same profile would both open the same
// SQLite file and both run the migration runner concurrently -- the second
// one used to roll back cleanly but blame the *migration*, rather than
// saying plainly that the app is already running. `requestSingleInstanceLock`
// is called as the very first thing in this file, before `app.whenReady()`
// or anything that touches a profile, specifically so a second launch never
// reaches `openProfile()`/`createProfileAndOpen()` (and therefore never
// opens a database file or runs a migration) at all -- it just quits,
// letting the first instance's `second-instance` handler below bring the
// existing window forward instead.
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
  // Finding 3 (phase 4b security review): every handler below that reads or
  // writes a credential -- the hosted-mode refresh/access tokens, or the
  // embedded API's session token -- now verifies `assertTrustedSender`
  // first. See that function's doc comment for what it actually checks and
  // why. `local-api:get-mode` and `updater:quitAndInstall` are deliberately
  // left as they were: neither reads nor writes anything sensitive, so
  // there is nothing here for an untrusted sender to gain.
  ipcMain.handle('tokens:getAccess', (event) => {
    assertTrustedSender(event, 'tokens:getAccess')
    return getAccessToken()
  })
  ipcMain.handle('tokens:getRefresh', (event) => {
    assertTrustedSender(event, 'tokens:getRefresh')
    return getRefreshToken()
  })
  ipcMain.handle('tokens:getPersistSession', (event) => {
    assertTrustedSender(event, 'tokens:getPersistSession')
    return getPersistSession()
  })
  ipcMain.handle(
    'tokens:set',
    (event, access: string, refresh: string, rememberMe?: boolean) => {
      assertTrustedSender(event, 'tokens:set')
      return setTokens(access, refresh, rememberMe !== false)
    },
  )
  ipcMain.handle('tokens:clear', (event) => {
    assertTrustedSender(event, 'tokens:clear')
    return clearTokens()
  })
  ipcMain.handle('updater:quitAndInstall', () => quitAndInstallUpdate())

  // --- Embedded local API handshake ---------------------------------------
  //
  // Registered unconditionally, before a profile has necessarily been
  // opened -- `localApiHandle` is read at *call* time (a closure over the
  // module-level variable), not captured here, so these two handlers always
  // report whatever is actually true at the moment the renderer asks, not
  // whatever was true when the app started listening.
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

  ipcMain.handle('local-api:request', (event, payload: LocalApiRequestPayload) => {
    assertTrustedSender(event, 'local-api:request')
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

  // --- Profile lifecycle (onboarding / picker) -----------------------------
  //
  // New IPC surface, new boundary -- everything the renderer supplies here
  // (`name`, `id`) is validated in main, not trusted because a renderer-side
  // check already looked at it (Phase 4b's security review finding: a
  // renderer-side check protects nothing on its own, since these handlers
  // are reachable directly from `window.profiles`, bypassing whatever the
  // renderer's own code does or does not check first).
  ipcMain.handle('profiles:get-situation', (event): ProfilesSituationPayload => {
    assertTrustedSender(event, 'profiles:get-situation')

    // A profile is already open (or `runApp` opened the sole one
    // automatically) -- nothing for the renderer to decide.
    if (localApiHandle) return { kind: 'ready' }

    if (!pendingProfileSituation) {
      // Unreachable in practice: `runApp` always sets either `localApiHandle`
      // or `pendingProfileSituation` before `createWindow()` runs, or quits
      // before creating a window at all (the corrupt-registry and failed-
      // single-profile-boot cases). Defensively reported as `'ready'` rather
      // than thrown, so a bug here fails toward "show the app and let a real
      // error surface from `local-api:get-mode`/requests" rather than
      // stranding the renderer on a screen with no situation to act on.
      return { kind: 'ready' }
    }

    if (pendingProfileSituation.kind === 'no-profiles') {
      return { kind: 'no-profiles' }
    }
    return { kind: 'multiple-profiles', profiles: pendingProfileSituation.profiles.map(toProfileSummary) }
  })

  ipcMain.handle('profiles:create', async (event, name: unknown): Promise<ProfilesSituationPayload> => {
    assertTrustedSender(event, 'profiles:create')

    if (localApiHandle) {
      throw new Error('profiles:create: a profile is already open.')
    }
    if (typeof name !== 'string') {
      // `validateProfileName` (inside `createProfileAndOpen`) only ever sees
      // a `string` -- IPC payloads are `unknown` until checked, and a
      // renderer that sent anything else (a compromised renderer, or a bug)
      // must not reach it with the wrong type.
      throw new Error('profiles:create: name must be a string.')
    }

    // Throws (InvalidProfileNameError, NewerDatabaseError -- unreachable for
    // a brand new profile but shares the type -- or a plain boot failure) if
    // anything goes wrong; deliberately left uncaught here so the renderer's
    // onboarding screen sees the real error and can let the user correct the
    // name or retry, rather than this handler papering over it.
    const handle = await createProfileAndOpen({ profileDir, name })
    localApiHandle = handle
    pendingProfileSituation = undefined
    return { kind: 'ready' }
  })

  ipcMain.handle('profiles:open', async (event, id: unknown): Promise<ProfilesSituationPayload> => {
    assertTrustedSender(event, 'profiles:open')

    if (localApiHandle) {
      throw new Error('profiles:open: a profile is already open.')
    }
    if (typeof id !== 'string') {
      throw new Error('profiles:open: id must be a string.')
    }

    // Re-reads the registry fresh rather than trusting `pendingProfileSituation`
    // (a snapshot taken at startup) or, worse, an id the renderer merely
    // echoes back -- this is the "validate in main" boundary a new IPC
    // surface requires: the id must name a profile that genuinely exists in
    // the registry right now, not just one the renderer once saw.
    const situation = resolveProfileSituation(profileDir)
    const candidates =
      situation.kind === 'multiple-profiles' ? situation.profiles : situation.kind === 'single-profile' ? [situation.profile] : []
    const profile = candidates.find((candidate) => candidate.id === id)
    if (!profile) {
      throw new Error(`profiles:open: no profile with id ${JSON.stringify(id)} was found.`)
    }

    const handle = await openProfile({ profileDir, profile })
    localApiHandle = handle
    pendingProfileSituation = undefined
    return { kind: 'ready' }
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
      // Finding 4 (phase 4b security review): the preload script
      // (`preload/index.ts`) uses only `contextBridge` and `ipcRenderer`,
      // both fully available under Electron's renderer sandbox -- there is
      // no Node built-in (`fs`, `path`, ...) it needs directly. `false` here
      // bought nothing and gave a compromised renderer more of the OS
      // process to work with than it needed.
      sandbox: true,
    },
  })

  // Finding 2 (phase 4b security review): deny every top-level navigation
  // that is not to this app's own renderer. Without this, a compromised
  // renderer (or a link it renders) could navigate the window to an
  // attacker-controlled origin -- which, combined with Finding 1's bridge
  // being reachable from `window.localApi` on *any* origin the window
  // happens to display, would let that remote page drive the embedded API
  // through this app's own IPC surface. This app has no legitimate external
  // link today (grepped for `https://`/`mailto:`/`target="_blank"` across
  // the renderer -- none exist), so there is nothing to allowlist through
  // `shell.openExternal` here; if one is ever added, it must be routed
  // through `shell.openExternal` explicitly, never through a relaxed guard.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppOwnUrl(url)) {
      event.preventDefault()
    }
  })

  // Same finding: deny every `window.open`/`target="_blank"` attempt outright
  // rather than opening a second, unmanaged `BrowserWindow` with its own
  // (potentially attacker-controlled) content -- see the comment above for
  // why there is nothing legitimate here to allowlist instead.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // In dev, electron-vite injects ELECTRON_RENDERER_URL
  if (RENDERER_DEV_SERVER_URL) {
    mainWindow.loadURL(RENDERER_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(RENDERER_INDEX_PATH)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Shows a blocking, native dialog naming what went wrong while opening a
 * profile -- used only for the failure that happens *before* any window
 * exists (the single-profile auto-open below), where there is no picker or
 * onboarding screen for the user to fall back to and retry from.
 *
 * `NewerDatabaseError` (see `local-api.ts`) gets a specific, actionable
 * message: the profile was migrated by a build newer than this one, and the
 * only way back is reinstalling that newer build, or restoring a snapshot
 * taken *before* the upgrade to it (never this database as it is now -- see
 * `migration-runner.ts`'s own doc comment for why). Every other failure (a
 * checksum mismatch, a CHECK-constraint violation, ...) gets a generic-but-
 * honest dialog instead of a raw stack trace, still naming the underlying
 * message so it can be reported.
 */
function showProfileBootErrorDialog(err: unknown): void {
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
}

/**
 * Opens the sole existing profile before any window is created (the
 * "exactly one profile" case -- see `runApp`). A failure here means the
 * user's one profile could not be opened at all: showing an empty window
 * on top of that would hide a real problem, and -- unlike a failure inside
 * `profiles:open` once a picker is already showing -- there is no other
 * profile to fall back to, so this shows a blocking dialog and lets the
 * caller quit instead.
 */
async function openSingleProfileOrShowError(profile: Profile): Promise<LocalApiHandle | undefined> {
  try {
    return await openProfile({ profileDir, profile })
  } catch (err) {
    showProfileBootErrorDialog(err)
    return undefined
  }
}

/**
 * Decides what to do about the user's profiles, then creates the window.
 *
 * Zero profiles or several: no profile is opened yet at all.
 * `pendingProfileSituation` records which of the two it is;
 * `createWindow()` still runs, and the renderer's profile gate
 * (`profiles:get-situation`) shows onboarding or a picker, which resolve
 * the situation via the `profiles:create`/`profiles:open` handlers
 * registered above. This is what makes it structurally impossible to reach
 * `AppLocalModule` (composed inside `openProfile`/`createProfileAndOpen`,
 * `local-api.ts`) without a `User` row already existing: neither IPC
 * handler calls it without first creating or locating a real registry
 * entry, and nothing else in this file ever sets `localApiHandle`.
 *
 * Exactly one profile: opened immediately, before the window exists --
 * same as this file did before this task, just without the auto-create
 * that used to run when the registry was empty.
 *
 * A corrupt registry: shown as the error it is (naming the underlying
 * message) and the app quits, **before any window is created at all**.
 * This is deliberate, not just convenient -- see `profile-protocol.ts`'s
 * doc comment: a corrupt registry never becomes a message the renderer
 * could receive, so "the picker/onboarding gate mishandles the corrupt
 * case as no-profiles" is not a bug this file's renderer-side code could
 * even have, regardless of how carefully (or not) that code is written.
 */
async function decideAndOpenProfiles(): Promise<boolean> {
  const situation = resolveProfileSituation(profileDir)

  if (situation.kind === 'corrupt-registry') {
    dialog.showErrorBox(
      'Wimm could not read your profiles',
      'Wimm found a profile index but could not read it:\n\n' +
        `${situation.message}\n\n` +
        'Your profile data is very likely still on disk -- this is a problem with the index that finds it, ' +
        'not with the financial data itself. Please back up the "profiles" folder inside Wimm\'s application ' +
        'data directory before trying anything else, then report this error.',
    )
    return false
  }

  if (situation.kind === 'single-profile') {
    localApiHandle = await openSingleProfileOrShowError(situation.profile)
    return localApiHandle !== undefined
  }

  // 'no-profiles' or 'multiple-profiles': nothing to open yet -- the
  // renderer's onboarding or picker screen resolves this.
  pendingProfileSituation = situation
  return true
}

async function runApp(): Promise<void> {
  await app.whenReady()

  // Finding 2 (phase 4b security review): deny every `<webview>` attach
  // attempt, on every webContents this app ever creates -- registered on
  // `app`, not on `mainWindow.webContents`, so it also covers any future
  // window (or a nested frame within one) this app creates, not just the
  // first one. This app never uses `<webview>` itself; a compromised
  // renderer trying to embed one would otherwise get an unmanaged, un-
  // sandboxed content surface of its own choosing.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })

  registerIpcHandlers()

  profileDir = join(app.getPath('userData'), 'profiles')

  const shouldContinue = await decideAndOpenProfiles()
  if (!shouldContinue) {
    // decideAndOpenProfiles already told the user what happened (a dialog,
    // for the corrupt-registry and failed-single-profile-open cases) --
    // nothing left to do but quit rather than open a window with no
    // working backend and no picker/onboarding to recover from.
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
