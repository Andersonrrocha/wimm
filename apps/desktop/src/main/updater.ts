import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires `electron-updater` against the GitHub Releases provider configured
 * in `package.json`'s `build.publish`. Sends progress events to the
 * renderer so `UpdateToast` (`renderer/components/update-toast.tsx`) can
 * surface updates without interrupting work.
 *
 * No-ops in dev (`electron-updater` refuses to run unpackaged, and there is
 * nothing published for a dev build to check against anyway).
 *
 * **Auto-download, but never auto-install.** `autoDownload = true` fetches a
 * new version's files in the background as soon as `checkForUpdatesAndNotify`
 * finds one -- safe to do silently because downloading only ever writes to
 * `electron-updater`'s own cache directory, never to a profile's database or
 * anything else this app's data-safety story depends on.
 *
 * `autoInstallOnAppQuit` is deliberately set to `false`, overriding
 * `electron-updater`'s own default of `true`. That default installs a
 * downloaded update the next time the app quits for ANY reason -- closing
 * the window, Cmd+Q, the OS shutting down -- with no confirmation and
 * nothing shown beyond a toast the user may never have looked at. That is a
 * poor default for an app whose entire purpose is owning the user's only
 * copy of their financial data: installing a new build means the profile
 * database gets migrated (`applyPendingMigrations`, run the next time the
 * profile opens) to a schema an OLDER build can never open again --
 * `migration-runner.ts`'s `DatabaseMigratedByNewerBuildError` refuses a
 * downgrade outright, it does not silently tolerate one. An update is
 * therefore a one-way door for the user's data, and walking through it must
 * be something the user deliberately chose, not a side effect of closing the
 * app for the night. With `autoInstallOnAppQuit` off, the ONLY path that
 * ever installs anything is `quitAndInstallUpdate` below, itself only ever
 * called from `UpdateToast`'s explicit "Restart" button, which only renders
 * once a download has actually finished (`state.kind === 'downloaded'`).
 *
 * See `updater.spec.ts`'s "setupAutoUpdater" describe block for the proof
 * that both flags are actually set this way, and that no event handler
 * registered here ever calls `quitAndInstall` on its own.
 */
export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

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
    updateReadyToInstall = true
    send('updater:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send('updater:error', { message: err?.message ?? 'unknown' })
  })

  // Offline is the normal state for this app (see the module doc comment of
  // whichever caller schedules this -- WIMM is offline-first and may go
  // weeks without connectivity): a failed check must never crash boot or
  // surface as an unhandled rejection. The failure still reaches the
  // renderer, via the 'error' event wired above, which `electron-updater`
  // emits for exactly this case (DNS failure, no route to GitHub, a 404 on
  // the feed, ...) before this promise ever rejects.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* swallowed: surfaced via 'error' event above */
  })
}

/**
 * True once `update-downloaded` has actually fired for this launch -- the
 * only condition under which `quitAndInstallUpdate` is allowed to touch
 * anything. Reset implicitly on every process start (this is a fresh module
 * instance each launch); there is no persisted "an update was ready last
 * time" state to go stale.
 */
let updateReadyToInstall = false

/**
 * Installs a downloaded update and restarts the app. The only caller is
 * `index.ts`'s `updater:quitAndInstall` IPC handler, itself only ever
 * invoked from `UpdateToast`'s explicit "Restart" button -- see
 * `setupAutoUpdater`'s doc comment for why nothing else in this process ever
 * reaches this function.
 *
 * **Refuses if no update has actually been downloaded.** Without this
 * guard, a stale or out-of-contract call (a renderer bug, or a future
 * caller that does not respect `UpdateToast`'s own `state.kind ===
 * 'downloaded'` gating) would still run the teardown below and tear down
 * the user's active profile connection for nothing: `electron-updater`'s own
 * `quitAndInstall` fails gracefully with an `'error'` event when there is
 * nothing to install, but by then this function would already have closed
 * the database out from under a still-running app. Checking first keeps a
 * no-op call an actual no-op.
 *
 * **Closes the current profile's connection FIRST, and awaits it, before
 * `electron-updater` is told to install anything.** `closeCurrentProfile` is
 * `index.ts`'s thin wrapper around `LocalApiHandle.close()` -- the exact
 * teardown Phase 4c task 3's `switchProfile` already proved genuinely
 * releases a profile's SQLite connection, reused here rather than a second
 * implementation of the same thing (see that function's doc comment,
 * `local-api.ts`).
 *
 * This deliberately does NOT rely on Electron's `before-quit` event to close
 * the connection instead, even though `index.ts` already has a `before-quit`
 * handler that would do exactly that once `autoUpdater.quitAndInstall()`
 * eventually calls `app.quit()`. The reason: `electron-updater`'s platform
 * backends do not agree on when `app.quit()` even runs relative to the
 * install step. On Windows, `NsisUpdater`/`BaseUpdater.quitAndInstall` calls
 * `install()` -- which spawns the NSIS installer executable -- SYNCHRONOUSLY,
 * and only calls `this.app.quit()` afterward, inside a `setImmediate` (see
 * `node_modules/electron-updater/out/BaseUpdater.js` and `NsisUpdater.js`).
 * A `before-quit` handler elsewhere in this process would therefore be
 * racing an already-running installer process rather than strictly
 * preceding it. Awaiting the close HERE, before `autoUpdater.quitAndInstall()`
 * is ever called, removes that race entirely, on every platform: by the time
 * any installer process exists, or `app.quit()` has even been requested, the
 * Nest app and its SQLite handle are already gone.
 *
 * See `updater.spec.ts`'s "quitAndInstallUpdate closes the profile
 * connection before installing" test for the mutation proof that this
 * ordering actually holds, using a real, held SQLite transaction and an
 * OS-level exclusive-lock probe -- not a spy on whether `close()` was merely
 * called.
 */
export async function quitAndInstallUpdate(closeCurrentProfile: () => Promise<void>): Promise<void> {
  if (!updateReadyToInstall) {
    return
  }

  await closeCurrentProfile()
  autoUpdater.quitAndInstall()
}
