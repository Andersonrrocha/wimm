import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { listProfiles, type Profile } from '@wimm/api/dist/prisma/local/profile-registry'
import {
  clearTokens,
  getAccessToken,
  getPersistSession,
  getRefreshToken,
  setTokens,
} from './store'
import {
  createProfileAndOpen,
  exportActiveProfileDatabase,
  listProfileBackups,
  NewerDatabaseError,
  openProfile,
  ProfileRestoreError,
  ProfileSwitchError,
  restoreProfileFromBackup,
  switchProfile,
  type LocalApiHandle,
} from './local-api'
import { forwardLocalApiRequest } from './local-api-bridge'
import { applyCsvMapping, proposeCsvMapping } from './csv-mapping-bridge'
import { resolveProfileSituation, type ProfileSituation } from './profile-lifecycle'
import { quitAndInstallUpdate, setupAutoUpdater } from './updater'
import type { ExportResult, ProfileBackups } from '../shared/backup-protocol'
import type { ApiMode, LocalApiRequestPayload } from '../shared/local-api-protocol'
import type { ProfileSummary, ProfilesSituationPayload } from '../shared/profile-protocol'
import type {
  CsvMappingApplyResult,
  CsvMappingProposal,
} from '../shared/csv-mapping-protocol'

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
 * production (an exact match on everything except the hash fragment -- see
 * below for why the fragment is deliberately ignored).
 *
 * Used both to decide whether a top-level navigation should be allowed
 * (Finding 2's `will-navigate` guard, below) and whether an IPC message
 * actually came from the app's own top-level frame (Finding 3's
 * `assertTrustedSender`, below) -- a compromised or navigated-away renderer
 * answers `false` to both.
 *
 * **Phase 4c task 3 bugfix: the packaged-build branch used to compare `url`
 * against `RENDERER_INDEX_FILE_URL` with plain `===`.** This app uses
 * `HashRouter` (`App.tsx`) for every in-app route -- `/transactions`,
 * `/settings`, and so on are all `#/transactions`, `#/settings`, ... on top
 * of the one `index.html` this build ever loads, never a real navigation to
 * a different file. But `event.senderFrame.url` (what `isTrustedSender`
 * reads on every IPC call, live) reflects the CURRENT hash, so the instant a
 * user navigated anywhere other than the root route, that exact-string
 * comparison stopped matching -- every subsequent `local-api:request` /
 * `tokens:*` / `profiles:*` call from that page rejected with "did not
 * originate from the app's own top-level renderer frame", in the packaged
 * build only (dev mode's origin-only comparison was never affected, since
 * `URL.origin` never includes the hash -- which is exactly why this went
 * unnoticed: this project's prior end-to-end proofs, e.g. task-4c-2's, never
 * happened to drive a packaged build past the root route). Found while
 * proving Task 3's switcher end-to-end: it lives on `#/settings`, and
 * without this fix `profiles:list`/`profiles:switch` -- and in fact every
 * IPC call on every non-root page of a packaged build -- would fail this
 * way. Fixed by comparing everything BUT the hash: a same-document hash
 * change is exactly the in-app navigation this check is supposed to allow,
 * and stripping only the hash (not loosening the origin, path, or query
 * comparison at all) keeps the check exactly as strict against every
 * genuine attack it defends against (a different origin, a different file,
 * a `file://` path elsewhere on disk) while finally tolerating the
 * legitimate case.
 */
function isAppOwnUrl(url: string): boolean {
  if (RENDERER_DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(RENDERER_DEV_SERVER_URL).origin
    } catch {
      return false
    }
  }
  try {
    const withoutHash = new URL(url)
    withoutHash.hash = ''
    return withoutHash.href === RENDERER_INDEX_FILE_URL
  } catch {
    return false
  }
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
 * Deliberately typed to exclude `'single-profile'`, `'corrupt-registry'`, and
 * `'registry-from-newer-version'`: `runApp` resolves all three itself,
 * before `createWindow()` ever runs (opening the profile directly, or
 * showing a dialog and quitting), so none of them can ever reach the
 * renderer -- see `runApp`'s own doc comment.
 */
let pendingProfileSituation: Extract<ProfileSituation, { kind: 'no-profiles' | 'multiple-profiles' }> | undefined

/** Strips `databaseFileName` before a `Profile` crosses into the renderer -- see `profile-protocol.ts`'s doc comment for why. */
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

  // --- CSV column mapping (Stage 2 task 5) ---------------------------------
  //
  // Unlike `local-api:request`, these two do not go through the embedded
  // API at all -- `proposeCsvMapping`/`applyCsvMapping` (`csv-mapping-bridge.ts`)
  // are pure functions with no database and no profile concept, so there is
  // nothing here for `localApiHandle` to gate on; both are registered
  // unconditionally, the same as `local-api:get-mode`. See that module's doc
  // comment for why this is a direct function call rather than a new HTTP
  // route, and for what "validate in main" means for a surface with no
  // auth/profile boundary to check in the first place: every value the
  // renderer supplies (`fileBytes`, `mapping`) is still `unknown` here and is
  // never handed to `@wimm/api` code unchecked.
  ipcMain.handle(
    'csv-mapping:propose',
    (event, fileBytes: unknown): CsvMappingProposal => {
      assertTrustedSender(event, 'csv-mapping:propose')
      return proposeCsvMapping(fileBytes)
    },
  )

  ipcMain.handle(
    'csv-mapping:apply',
    (event, fileBytes: unknown, mapping: unknown): CsvMappingApplyResult => {
      assertTrustedSender(event, 'csv-mapping:apply')
      return applyCsvMapping(fileBytes, mapping)
    },
  )

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
    if (localApiHandle) return { kind: 'ready', profile: toProfileSummary(localApiHandle.profile) }

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
    return { kind: 'ready', profile: toProfileSummary(handle.profile) }
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
    return { kind: 'ready', profile: toProfileSummary(handle.profile) }
  })

  // --- Profile switching (Phase 4c task 3) ---------------------------------
  //
  // `profiles:list` and `profiles:switch` are only meaningful once a profile
  // is already open (the settings screen that offers "switch profile" only
  // renders once the app itself does) -- unlike `profiles:get-situation`,
  // neither one consults `pendingProfileSituation` at all.

  ipcMain.handle('profiles:list', (event): ProfileSummary[] => {
    assertTrustedSender(event, 'profiles:list')

    // Deliberately left uncaught: a corrupt registry here is a genuine,
    // reportable error (see profile-registry.ts's module doc comment for
    // why "corrupt" and "empty" must never be conflated) -- the renderer's
    // switch screen shows it inline rather than this handler papering over
    // it with an empty list, which would look identical to "there are no
    // other profiles" and hide a real problem.
    return listProfiles(profileDir).map(toProfileSummary)
  })

  ipcMain.handle('profiles:switch', async (event, id: unknown): Promise<ProfilesSituationPayload> => {
    assertTrustedSender(event, 'profiles:switch')

    if (!localApiHandle) {
      throw new Error('profiles:switch: no profile is currently open to switch away from.')
    }
    if (typeof id !== 'string') {
      throw new Error('profiles:switch: id must be a string.')
    }
    if (id === localApiHandle.profile.id) {
      // Already the active profile -- a no-op, not an error. Avoids tearing
      // down and rebooting the very profile the user is already using
      // merely because they clicked their own entry in the switcher.
      return { kind: 'ready', profile: toProfileSummary(localApiHandle.profile) }
    }

    // Re-reads the registry fresh -- the same "validate in main, never
    // trust a renderer-supplied id" contract `profiles:open` already
    // follows (see that handler above).
    const target = listProfiles(profileDir).find((candidate) => candidate.id === id)
    if (!target) {
      throw new Error(`profiles:switch: no profile with id ${JSON.stringify(id)} was found.`)
    }

    const current = localApiHandle
    // Nothing is reported open while the switch is in flight -- matches
    // `switchProfile`'s own hard requirement (close current before target
    // is ever touched): there is no moment where `localApiHandle` points at
    // a handle this process is concurrently tearing down.
    localApiHandle = undefined

    try {
      localApiHandle = await switchProfile({ profileDir, current, target })
      return { kind: 'ready', profile: toProfileSummary(localApiHandle.profile) }
    } catch (err) {
      if (err instanceof ProfileSwitchError) {
        // `switchProfile` already attempted to land the user back on the
        // profile they started from -- see that function's doc comment.
        // `rolledBackHandle` is whatever it managed: a working handle for
        // the original profile in the common case, or `undefined` in the
        // rare case that reopen also failed.
        localApiHandle = err.rolledBackHandle

        if (!localApiHandle) {
          // Nothing is running at all. Re-derive the picker/onboarding
          // situation so a renderer reload -- the existing
          // `local-backend-error` screen's own recovery action, reused
          // rather than inventing a second failure surface (see this
          // task's report) -- lands the user on a real recovery screen
          // instead of a `profiles:get-situation` call that has nothing
          // accurate to report. `resolveProfileSituation` can also report
          // `'single-profile'` or `'corrupt-registry'` here in principle;
          // neither is renderer-facing (see `pendingProfileSituation`'s own
          // doc comment), so this leaves it `undefined` for those two --
          // exactly as rare as "switching was possible in the first place
          // (at least two profiles existed) and the registry corrupted
          // itself in the few milliseconds since."
          const fallback = resolveProfileSituation(profileDir)
          pendingProfileSituation =
            fallback.kind === 'no-profiles' || fallback.kind === 'multiple-profiles' ? fallback : undefined
        }

        // Re-thrown as a plain Error: IPC serializes the message across to
        // the renderer either way, and `ProfileSwitchError`'s own class
        // identity does not survive that trip -- see `profiles:open`'s
        // handler above for the same pattern.
        throw new Error(err.message)
      }
      throw err
    }
  })

  // --- Export and restore (Phase 4c task 4) --------------------------------
  //
  // Both operate on a profile identified by id, re-read fresh from the
  // registry -- the same "validate in main, never trust a renderer-supplied
  // id" contract every other new IPC surface in this phase follows.
  // `backups:list`/`backups:restore` deliberately do NOT require `profileId`
  // to be the currently active profile: a user with more than one profile
  // can browse and restore a DIFFERENT, already-closed profile's own
  // backups from here too (see `restoreProfileFromBackup`'s doc comment,
  // "the multi-profile recovery path") -- reachable only once SOME profile
  // is open (Settings does not exist otherwise), asserted below.

  ipcMain.handle('backups:list', (event, profileId: unknown): ProfileBackups => {
    assertTrustedSender(event, 'backups:list')
    if (!localApiHandle) {
      throw new Error('backups:list: no profile is currently open.')
    }
    if (typeof profileId !== 'string') {
      throw new Error('backups:list: profileId must be a string.')
    }
    const profile = listProfiles(profileDir).find((candidate) => candidate.id === profileId)
    if (!profile) {
      throw new Error(`backups:list: no profile with id ${JSON.stringify(profileId)} was found.`)
    }
    return listProfileBackups(profileDir, profile)
  })

  ipcMain.handle('backups:export', async (event): Promise<ExportResult> => {
    assertTrustedSender(event, 'backups:export')
    if (!localApiHandle) {
      throw new Error('backups:export: no profile is currently open.')
    }
    // Always the active profile -- D8 (see the phase plan) is explicit that
    // export copies THE active profile, never an arbitrary one picked by
    // id, which keeps this handler's attack surface to "which file the
    // user is allowed to save their own currently-open data as."
    const profile = localApiHandle.profile

    const saveDialogOptions = {
      title: 'Export Wimm Profile',
      defaultPath: `${sanitizeForFileName(profile.name)}.db`,
      filters: [{ name: 'Wimm Profile', extensions: ['db'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions)
    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    exportActiveProfileDatabase(profileDir, profile, result.filePath)
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('backups:restore', async (event, payload: unknown): Promise<ProfilesSituationPayload> => {
    assertTrustedSender(event, 'backups:restore')
    if (!localApiHandle) {
      throw new Error('backups:restore: no profile is currently open.')
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('backups:restore: invalid payload.')
    }
    const { profileId, fileName } = payload as { profileId?: unknown; fileName?: unknown }
    if (typeof profileId !== 'string' || typeof fileName !== 'string') {
      throw new Error('backups:restore: profileId and fileName must both be strings.')
    }

    const profile = listProfiles(profileDir).find((candidate) => candidate.id === profileId)
    if (!profile) {
      throw new Error(`backups:restore: no profile with id ${JSON.stringify(profileId)} was found.`)
    }

    const isActive = localApiHandle.profile.id === profileId
    const current = isActive ? localApiHandle : undefined
    if (isActive) {
      // Nothing is reported open while the restore is in flight -- matches
      // `profiles:switch`'s own contract (see that handler above).
      localApiHandle = undefined
    }

    try {
      const result = await restoreProfileFromBackup({ profileDir, profile, fileName, current })
      if (isActive) {
        localApiHandle = result
      }
      // Restoring a non-active profile never touches `localApiHandle` at
      // all -- `result` is always `undefined` in that branch (see
      // `restoreProfileFromBackup`'s doc comment) and `localApiHandle`
      // still holds whatever profile was already open.
      if (!localApiHandle) {
        // Only reachable in the (rare) isActive branch where the reopen
        // after a successful restore itself failed without throwing --
        // structurally not expected (a successful restoreSnapshot's reopen
        // failure surfaces as ProfileRestoreError below instead), kept as a
        // defensive fallback rather than asserting non-null.
        throw new Error('backups:restore: profile is unexpectedly not open after a successful restore.')
      }
      return { kind: 'ready', profile: toProfileSummary(localApiHandle.profile) }
    } catch (err) {
      if (err instanceof ProfileRestoreError) {
        if (isActive) {
          localApiHandle = err.rolledBackHandle

          if (!localApiHandle) {
            // Mirrors `profiles:switch`'s own fallback: re-derive the
            // picker/onboarding situation so a renderer reload lands on a
            // real recovery screen instead of nothing.
            const fallback = resolveProfileSituation(profileDir)
            pendingProfileSituation =
              fallback.kind === 'no-profiles' || fallback.kind === 'multiple-profiles' ? fallback : undefined
          }
        }
        throw new Error(err.message)
      }

      if (isActive) {
        // Restore never touched `current` -- restore it exactly as it was.
        localApiHandle = current
      }
      throw err
    }
  })
}

/**
 * A best-effort, filesystem-safe filename derived from a user-chosen
 * profile name -- used only as `dialog.showSaveDialog`'s suggested
 * `defaultPath` basename, which the OS dialog itself still lets the user
 * freely edit or replace before confirming. Unlike `databaseFileName`
 * (`profile-registry.ts`), this never becomes an actual path segment this
 * app writes to on its own, so it does not need `validateProfileName`'s
 * full guarantees -- it only needs to avoid characters most filesystems
 * reject outright, so the suggested name is not itself rejected by the save
 * dialog before the user even gets to see it.
 */
function sanitizeForFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching C0 controls alongside the usual reserved filesystem characters.
  const cleaned = name.replace(/[\x00-\x1f<>:"/\\|?*]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'wimm-profile'
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
 *
 * **Phase 4c task 4: this dialog now names the real Restore feature by its
 * exact location instead of gesturing vaguely at "a backup snapshot".**
 * Restore lives in Settings, and Settings only exists once SOME profile is
 * open -- which is exactly what this dialog fires *without* (this is the
 * sole-profile, pre-window boot path; see this function's own doc comment
 * above). So the guidance splits on the one fact that actually matters
 * here: a person with more than one profile on this computer can open a
 * DIFFERENT, working one and restore THIS profile from there (`backups:*`
 * deliberately lets Settings browse and restore ANY registered profile's
 * backups, not only the active one -- see `restoreProfileFromBackup`'s doc
 * comment, "the multi-profile recovery path"); a person for whom this is
 * their only profile has no window to reach Settings through at all, and
 * reinstalling the newer build remains the only way back in. Both paths are
 * stated plainly rather than only the one that happens to apply, since this
 * dialog has no way to know in advance how many profiles exist.
 */
function showProfileBootErrorDialog(err: unknown): void {
  if (err instanceof NewerDatabaseError) {
    dialog.showErrorBox(
      'This profile was created by a newer version of Wimm',
      `${err.message}\n\nWimm cannot open this profile with the version currently installed.\n\n` +
        'If you have another profile on this computer, open that one, then use Settings -> Backups -> Restore ' +
        'from Backup to restore THIS profile from a snapshot taken BEFORE you last upgraded it (not this ' +
        'database as it is now). If this is your only profile, the only way back in is reinstalling the newer ' +
        'version of Wimm.',
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
 *
 * A registry written by a newer build of Wimm (`'registry-from-newer-
 * version'`): handled the same way as a corrupt registry -- a blocking
 * dialog, then quit, before any window exists -- but with its OWN message,
 * never the corrupt-registry one. Telling a user their profile index is
 * "corrupt" when the real problem is "this build is older than the one that
 * wrote it" sends them down a recovery path for a problem they do not have;
 * see `profile-lifecycle.ts`'s `ProfileSituation` doc comment and
 * `profile-registry.ts`'s `ProfileRegistryWrittenByNewerBuildError`.
 */
async function decideAndOpenProfiles(): Promise<boolean> {
  const situation = resolveProfileSituation(profileDir)

  if (situation.kind === 'registry-from-newer-version') {
    dialog.showErrorBox(
      'This profile index was created by a newer version of Wimm',
      `${situation.message}\n\n` +
        'Wimm cannot read your profile list with the version currently installed. This is NOT a corrupt index -- ' +
        'it is well-formed, just written by a newer build. Your profile data itself has not been touched.\n\n' +
        'Please update Wimm to the latest version to see your profiles again.',
    )
    return false
  }

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
