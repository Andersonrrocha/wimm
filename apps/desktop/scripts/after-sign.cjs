/**
 * electron-builder `afterSign` hook.
 *
 * **Why this exists.** No Developer ID / non-Apple signing certificate is
 * configured in this repository (see `apps/desktop/package.json`'s `build`
 * block -- no `mac.identity`). When `electron-builder` cannot find one, it
 * does not fall back to an ad-hoc signature on its own: it logs "skipped
 * macOS application code signing" and leaves the app bundle exactly as
 * `electron`'s own upstream template shipped it. That template's *inner*
 * pieces (`Electron Framework.framework`, the helper `.app`s) already carry
 * their own valid ad-hoc signatures from Electron's own build, untouched.
 * But the *outer* `Wimm.app` bundle has been modified since those signatures
 * were computed -- `electron-builder` swaps in this app's `Info.plist`, icon,
 * and `app.asar` (which itself is inside `Contents/Resources`) -- so the
 * outer bundle's own code-signature seal (if it has a stale/inherited one at
 * all) no longer matches its actual contents. Confirmed empirically:
 * `codesign --verify --deep --strict Wimm.app` on the unsigned output of
 * `electron-builder package` reports "code has no resources but signature
 * indicates they must be present" -- a broken seal, not a clean "unsigned"
 * state. A broken/inconsistent code signature (as opposed to a genuinely
 * absent one) is what the macOS launch path validates lazily and can hang
 * on indefinitely for a locally-built, never-launched bundle -- this was
 * observed directly while proving Task 4's packaged build boots: the app
 * process spawned and sat on frame `ElectronMain` (its own native startup,
 * before any Node/JS ever runs) for minutes with zero output, confirmed via
 * `sample`, while `codesign --verify` on the same build failed with exactly
 * the seal-mismatch message above.
 *
 * **The fix, and why it does not weaken anything `/security-review` cares
 * about.** Re-sign the *whole* bundle ad-hoc (`--sign -`) after packaging,
 * `--deep` so every nested framework/helper gets a *consistent* seal over
 * its current (post-electron-builder) contents, rather than leaving a stale
 * seal from before those contents were modified. This is strictly *adding*
 * a correct signature, never removing or bypassing one: hardened runtime is
 * not touched (an ad-hoc signature cannot carry hardened-runtime
 * entitlements at all, so there is nothing to weaken there), Gatekeeper's
 * quarantine/notarization checks are unaffected (this build has no
 * quarantine attribute and was never going to pass notarization without a
 * real Developer ID, ad-hoc or not), and `contextIsolation`/`nodeIntegration`
 * are renderer-process configuration this hook never touches. Ad-hoc signing
 * a locally-built, unsigned app for local testing is the normal, unprivileged
 * thing every macOS developer's own `codesign -s -` already does -- it is
 * not a security downgrade relative to the broken-seal state `electron-builder`
 * left behind on its own.
 *
 * If a real Developer ID identity is ever configured (`mac.identity` /
 * `CSC_NAME` / `CSC_LINK`), this hook must not run at all: `codesign --sign -`
 * would *replace* electron-builder's own properly-sealed, real signature with
 * an ad-hoc one, silently breaking notarization and Gatekeeper distribution
 * for a build that would otherwise have worked. The guard below checks for
 * exactly that configuration (mirroring the same three places
 * `electron-builder` itself reads an identity from) and skips re-signing
 * entirely when any of them is present -- this repo has none of them today,
 * so that branch is exercised by this guard's own logic, not by a real
 * signed build.
 */
const { execFileSync } = require('child_process')
const path = require('path')

function hasConfiguredIdentity(context) {
  const macConfig = context.packager.config.mac || {}
  return macConfig.identity != null || !!process.env.CSC_NAME || !!process.env.CSC_LINK
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  if (hasConfiguredIdentity(context)) {
    console.log('[after-sign] a real signing identity is configured -- skipping the ad-hoc re-sign entirely')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  console.log(`[after-sign] ad-hoc re-signing ${appPath} (no Developer ID identity configured in this repo)`)

  execFileSync(
    'codesign',
    ['--sign', '-', '--force', '--deep', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  )

  console.log('[after-sign] done')
}
