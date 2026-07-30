/**
 * Resolves which transport the renderer's axios instance should use:
 * `'local'` (route through the embedded API's IPC adapter) or `'hosted'`
 * (the existing direct-HTTP path, unchanged).
 *
 * **Mode comes from main, never from a guess or an env var read here.** Main
 * is the only process that knows whether it actually booted the embedded
 * API (see `startLocalApi` in `apps/desktop/src/main/local-api.ts`) --
 * asking it over IPC, rather than inferring the answer from, say, whether
 * `import.meta.env.VITE_API_URL` is set, is what makes this correct even if
 * that env var's meaning ever changes independently of what main actually
 * did.
 *
 * **Resolved once, cached for the life of the renderer.** The mode cannot
 * change mid-session (there is no UI for switching between an embedded
 * profile and a hosted server while the app is running), so asking main
 * again on every request would be a pure round-trip cost with no
 * correctness benefit. `__resetApiModeCacheForTests` exists solely so tests
 * can exercise both branches from a clean slate -- production code never
 * calls it.
 *
 * Kept dependency-injected (`source` is a parameter, not read from
 * `window` in this module) so this file has no DOM/Electron dependency at
 * all and can be unit-tested under a plain Node environment, same as
 * `apps/desktop/src/main`'s specs. `api-client.ts` is what actually passes
 * `window.localApi` in.
 */
export type ApiMode = { mode: 'local' } | { mode: 'hosted' }

export interface ApiModeSource {
  getMode: () => Promise<ApiMode>
}

let cachedModePromise: Promise<ApiMode> | null = null

/**
 * Resolves the mode via `source` (if provided) or falls back to `'hosted'`
 * when `source` is undefined -- the safe default for any context with no
 * IPC bridge at all (e.g. this module's own test environment), since
 * `'hosted'` is the mode that requires nothing extra to already exist.
 */
export function resolveApiMode(source: ApiModeSource | undefined): Promise<ApiMode> {
  if (!cachedModePromise) {
    cachedModePromise = source ? source.getMode() : Promise.resolve({ mode: 'hosted' })
  }
  return cachedModePromise
}

/** Test-only: clears the cache so a test can exercise `resolveApiMode` from a clean slate. Never called from production code. */
export function __resetApiModeCacheForTests(): void {
  cachedModePromise = null
}
