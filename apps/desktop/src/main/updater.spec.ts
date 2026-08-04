/**
 * Behavioral proof for `updater.ts` -- Stage 4 task 4.4 of the desktop
 * completion program (`docs/superpowers/plans/2026-08-03-desktop-completion-
 * program.md`), the updater dry run. `electron-updater` has been a
 * dependency since Phase 4a and `build.publish` has pointed at GitHub since
 * then too, but neither had ever been exercised before this task -- there
 * was no `updater.spec.ts` at all.
 *
 * **What this file proves, and what it deliberately does not.** Real
 * signing and notarization are Stage 5, blocked on an Apple Developer
 * account (see the plan's Stage 5 section) -- nothing here drives a real
 * signed update through `electron-updater`'s signature verification or
 * installs a real binary. What IS provable without a signed build, and is
 * proven below:
 *
 * - The check path, including the normal-for-this-app case of no network at
 *   all (WIMM is offline-first and may go weeks without connectivity).
 * - `update-available` / `update-not-available` / `download-progress` /
 *   `update-downloaded` / `error` are all forwarded to the renderer
 *   correctly, and never sent to a destroyed or missing window.
 * - The app's own consent decision: `autoDownload = true` (safe -- it only
 *   ever writes to `electron-updater`'s own cache, never a profile's
 *   database) but `autoInstallOnAppQuit = false` (deliberately overriding
 *   `electron-updater`'s own default) -- see `updater.ts`'s `setupAutoUpdater`
 *   doc comment for the full reasoning: a downgrade after an update is
 *   refused outright (`DatabaseMigratedByNewerBuildError`), so installing a
 *   new build is a one-way door for the user's data and must never happen as
 *   a side effect of just closing the app for the night.
 * - The part that actually matters for a personal-finance app:
 *   `quitAndInstallUpdate` genuinely releases the active profile's database
 *   connection, and awaits that release, before `electron-updater` is ever
 *   told to install anything -- proven with a real, held SQLite transaction
 *   and an OS-level exclusive-lock probe
 *   (`test-support/exclusive-lock-probe.ts`, the same technique
 *   `local-api.spec.ts`'s `switchProfile` proof uses), not a spy on whether
 *   some `close()` function was merely called. See that test's own comment
 *   for why a call-order spy alone would not be trustworthy here.
 *
 * **Why every test re-requires `./updater` from scratch.** Neither
 * `electron` nor `electron-updater` can be imported outside a real Electron
 * process the normal way (`require('electron')` outside one resolves to a
 * path string, not the API surface) -- every test mocks both with
 * `jest.doMock` (never the hoisted `jest.mock`: hoisting would run the mock
 * factory before this file's own `import { EventEmitter } from 'node:events'`
 * exists to close over) and then `require`s `./updater` fresh, after calling
 * `jest.resetModules()`. This also resets `updater.ts`'s private,
 * module-level `updateReadyToInstall` flag between tests -- it has no reset
 * hook of its own by design (see that variable's doc comment), so a fresh
 * module instance is the only way to test it in isolation without reaching
 * into internals.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { profileDatabasePath } from '@wimm/api/dist/prisma/local/profile-registry'

import { createProfileAndOpen, type LocalApiHandle } from './local-api'
import { canAcquireExclusiveLock, holdOpenTransaction } from './test-support/exclusive-lock-probe'

jest.setTimeout(30000)

/**
 * Minimal double for `electron-updater`'s `autoUpdater` singleton. It
 * genuinely IS an `EventEmitter` at runtime (electron-updater's `AppUpdater`
 * extends it) -- extending the real class here, rather than hand-rolling
 * `on`/`emit`, is what lets tests below drive `updater.ts`'s event handlers
 * by emitting real events, the same way `electron-updater` itself would.
 */
class FakeAutoUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  checkForUpdatesAndNotify = jest.fn(async (): Promise<unknown> => undefined)
  quitAndInstall = jest.fn()
}

/** Minimal double for the `BrowserWindow` `setupAutoUpdater` sends updater events to. */
function fakeWindow(destroyed = false): { isDestroyed: () => boolean; webContents: { send: jest.Mock } } {
  return { isDestroyed: () => destroyed, webContents: { send: jest.fn() } }
}

interface UpdaterModule {
  setupAutoUpdater: (getMainWindow: () => ReturnType<typeof fakeWindow> | null) => void
  quitAndInstallUpdate: (closeCurrentProfile: () => Promise<void>) => Promise<void>
}

/**
 * Loads a completely fresh `./updater` module, with a fresh
 * `electron-updater` `autoUpdater` double wired in via `jest.doMock`, so
 * every test starts with `updateReadyToInstall` unset, no listeners
 * registered, and no call history left over from a previous test.
 * `isPackaged` controls the mocked `electron`'s `app.isPackaged` -- the one
 * thing `setupAutoUpdater` branches on before touching `electron-updater` at
 * all.
 */
function loadUpdaterModule(isPackaged: boolean): UpdaterModule & { autoUpdater: FakeAutoUpdater } {
  jest.resetModules()

  const autoUpdater = new FakeAutoUpdater()
  jest.doMock('electron', () => ({
    app: { isPackaged },
    BrowserWindow: class {},
  }))
  jest.doMock('electron-updater', () => ({ autoUpdater }))

  // eslint-disable-next-line @typescript-eslint/no-var-requires -- must be required AFTER the doMock calls above, never statically imported.
  const mod = require('./updater') as UpdaterModule
  return { ...mod, autoUpdater }
}

describe('setupAutoUpdater', () => {
  it('no-ops entirely when the app is not packaged (dev mode)', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(false)

    setupAutoUpdater(() => null)

    expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled()
    expect(autoUpdater.listenerCount('update-available')).toBe(0)
    // Neither flag is ever touched in dev -- both stay at whatever
    // electron-updater's own defaults happen to be.
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it(
    'packaged: downloads updates automatically but never installs without an explicit click -- ' +
      'autoDownload is true, autoInstallOnAppQuit is false',
    () => {
      const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)

      setupAutoUpdater(() => null)

      expect(autoUpdater.autoDownload).toBe(true)
      expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    },
  )

  it('packaged: checks for updates exactly once, on setup', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)

    setupAutoUpdater(() => null)

    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1)
  })

  it(
    'a rejected update check -- no network, the normal state for this offline-first app -- does not throw ' +
      'or crash setup; the renderer learns about it only via the error event',
    async () => {
      const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
      autoUpdater.checkForUpdatesAndNotify.mockRejectedValue(new Error('getaddrinfo ENOTFOUND github.com'))

      const win = fakeWindow()
      expect(() => setupAutoUpdater(() => win)).not.toThrow()

      // Let the rejected promise's .catch() actually run before asserting
      // nothing else observed it.
      await Promise.resolve()
      await Promise.resolve()

      expect(win.webContents.send).not.toHaveBeenCalled()
    },
  )

  it('forwards update-available to the renderer, carrying the new version', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    const win = fakeWindow()
    setupAutoUpdater(() => win)

    autoUpdater.emit('update-available', { version: '2.4.0' })

    expect(win.webContents.send).toHaveBeenCalledWith('updater:available', { version: '2.4.0' })
  })

  it('forwards update-not-available to the renderer', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    const win = fakeWindow()
    setupAutoUpdater(() => win)

    autoUpdater.emit('update-not-available', {})

    expect(win.webContents.send).toHaveBeenCalledWith('updater:not-available', null)
  })

  it('forwards download-progress to the renderer', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    const win = fakeWindow()
    setupAutoUpdater(() => win)

    autoUpdater.emit('download-progress', { percent: 42.7 })

    expect(win.webContents.send).toHaveBeenCalledWith('updater:download-progress', { percent: 42.7 })
  })

  it('forwards update-downloaded to the renderer', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    const win = fakeWindow()
    setupAutoUpdater(() => win)

    autoUpdater.emit('update-downloaded', { version: '2.4.0' })

    expect(win.webContents.send).toHaveBeenCalledWith('updater:downloaded', { version: '2.4.0' })
  })

  it('forwards error to the renderer, falling back to "unknown" when the error carries no message', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    const win = fakeWindow()
    setupAutoUpdater(() => win)

    autoUpdater.emit('error', new Error('signature verification failed'))
    autoUpdater.emit('error', undefined)

    expect(win.webContents.send).toHaveBeenNthCalledWith(1, 'updater:error', {
      message: 'signature verification failed',
    })
    expect(win.webContents.send).toHaveBeenNthCalledWith(2, 'updater:error', { message: 'unknown' })
  })

  it('never sends to a missing or already-destroyed window', () => {
    const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
    let currentWindow: ReturnType<typeof fakeWindow> | null = null
    setupAutoUpdater(() => currentWindow)

    autoUpdater.emit('update-available', { version: '2.4.0' })
    // No window at all yet -- nothing to assert on except that this did not throw.

    currentWindow = fakeWindow(true)
    expect(() => autoUpdater.emit('update-available', { version: '2.4.0' })).not.toThrow()
    expect(currentWindow.webContents.send).not.toHaveBeenCalled()
  })

  it(
    'never calls quitAndInstall on its own, through any event -- the only path that ever installs anything ' +
      'is an explicit click, via quitAndInstallUpdate (see the describe block below)',
    () => {
      const { setupAutoUpdater, autoUpdater } = loadUpdaterModule(true)
      setupAutoUpdater(() => fakeWindow())

      autoUpdater.emit('update-available', { version: '2.4.0' })
      autoUpdater.emit('download-progress', { percent: 50 })
      autoUpdater.emit('update-downloaded', { version: '2.4.0' })
      autoUpdater.emit('update-not-available', {})
      autoUpdater.emit('error', new Error('boom'))

      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    },
  )
})

describe('quitAndInstallUpdate', () => {
  it('does nothing when no update has been downloaded yet -- neither closes anything nor calls electron-updater', async () => {
    const { quitAndInstallUpdate, autoUpdater } = loadUpdaterModule(true)
    const closeCurrentProfile = jest.fn(async () => undefined)

    await quitAndInstallUpdate(closeCurrentProfile)

    expect(closeCurrentProfile).not.toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it(
    "closes the active profile's database connection, and awaits it, before telling electron-updater to " +
      'install anything -- proven with a real, held SQLite transaction and an OS-level exclusive-lock probe ' +
      'taken at the EXACT moment autoUpdater.quitAndInstall is invoked, not a call-order spy on mock functions ' +
      '(a call-order spy would pass even if the underlying connection were still open -- see ' +
      '`test-support/exclusive-lock-probe.ts` for why only an OS-level probe, using the same better-sqlite3 ' +
      'build LocalPrismaService actually runs on, proves anything about the operating system)',
    async () => {
      const { setupAutoUpdater, quitAndInstallUpdate, autoUpdater } = loadUpdaterModule(true)
      // Reaches the point where an 'update-downloaded' event can flip
      // quitAndInstallUpdate's internal guard -- the network check itself is
      // irrelevant here and already proven separately above.
      setupAutoUpdater(() => null)

      const profileDir = mkdtempSync(join(tmpdir(), 'wimm-updater-spec-'))
      let handle: LocalApiHandle | undefined
      try {
        handle = await createProfileAndOpen({ profileDir, name: 'Profile under update' })
        const dbFile = profileDatabasePath(profileDir, handle.profile)

        const held = holdOpenTransaction(handle)
        await held.started

        // Sanity check on the setup itself, not on quitAndInstallUpdate: the
        // lock is genuinely held BEFORE quitAndInstallUpdate runs. Without
        // this, a bug that made holdOpenTransaction a no-op would make the
        // main assertion below pass vacuously -- the same discipline
        // local-api.spec.ts's switchProfile proof uses.
        expect(canAcquireExclusiveLock(dbFile)).toBe(false)

        let lockWasFreeAtInstallTime: boolean | undefined
        autoUpdater.quitAndInstall.mockImplementation(() => {
          lockWasFreeAtInstallTime = canAcquireExclusiveLock(dbFile)
        })

        autoUpdater.emit('update-downloaded', { version: '9.9.9' })

        await quitAndInstallUpdate(async () => {
          await handle!.close()
          handle = undefined
        })

        expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
        // The mandatory assertion: at the exact moment electron-updater was
        // asked to install, an independent connection could immediately
        // acquire an exclusive lock on the profile's file -- proving the
        // connection was already, genuinely closed by then, not just that
        // some close() function had been called somewhere.
        expect(lockWasFreeAtInstallTime).toBe(true)

        held.release()
        await held.settled
      } finally {
        if (handle) {
          await (handle as LocalApiHandle).close().catch(() => {})
        }
        rmSync(profileDir, { recursive: true, force: true })
      }
    },
  )
})
