import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfileSummary } from '../../shared/profile-protocol'
import { useAuth } from '../context/auth-context'
import { Button } from './ui/button'

/**
 * Local-mode-only settings section (Phase 4c task 3) that lists every
 * registered profile and lets the user switch to a different one. Renders
 * nothing at all outside local mode -- `window.profiles` does not exist in
 * a hosted build, and there is no concept of "switching profiles" there.
 *
 * **What happens on success.** `window.profiles.switch` tears the embedded
 * API down and reboots it against the target profile's database
 * (`local-api.ts`'s `switchProfile`) -- an entirely different SQLite file,
 * with different transactions, categories, sources. `window.location.reload()`
 * is deliberate here rather than patching React Query's cache and
 * `AuthProvider`'s state piecemeal: a full reload re-mounts `ProfileGate`,
 * `AuthProvider`, and `QueryClientProvider` from scratch, which is the only
 * way to guarantee nothing left over from the old profile (a cached
 * transaction list, a stale `user` object -- even though it happens to
 * carry the same synthetic local identity, its DATA does not) survives the
 * switch. The renderer never needs to know the new session token either --
 * `local-api-bridge.ts` injects whichever token `localApiHandle` (main)
 * currently holds, read fresh on every request.
 *
 * **What happens on failure.** `switchProfile` (main) has already attempted
 * to land back on the profile the user started from before this promise
 * ever rejects -- see that function's doc comment. This component shows
 * the failure inline (mirroring `ProfilePickerScreen`'s existing pattern for
 * `profiles:open` failures) and calls `refreshUser()` to re-check reality
 * rather than assuming the rollback worked:
 * - If it worked, `refreshUser()` just reconfirms `authenticated`, a
 *   harmless no-op -- the user stays exactly where they were, working.
 * - If even the rollback failed (nothing is running), `refreshUser()`'s
 *   `/users/me` call fails and `AuthProvider` transitions to
 *   `local-backend-error`, which `ProtectedRoute` already renders as its
 *   own dedicated, actionable screen. Reusing that existing surface -- see
 *   this task's report -- is deliberate: it is never a blank window and
 *   never the (nonexistent, in local mode) login screen.
 */
export function ProfileSwitcher(): JSX.Element | null {
  const { t } = useTranslation()
  const { mode, refreshUser } = useAuth()
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  useEffect(() => {
    if (mode?.mode !== 'local' || !window.profiles) return
    let cancelled = false

    void Promise.all([window.profiles.list(), window.profiles.getSituation()])
      .then(([list, situation]) => {
        if (cancelled) return
        setProfiles(list)
        setCurrentId(situation.kind === 'ready' ? (situation.profile?.id ?? null) : null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [mode])

  if (mode?.mode !== 'local') return null
  // Nothing to switch to -- hide the section entirely rather than showing
  // a list of one with no action available. `null` (still loading) and
  // `loadError` (something to report) both still render, so a genuine
  // failure to load is never silently hidden alongside "there is only one
  // profile".
  if (profiles !== null && !loadError && profiles.length <= 1) return null

  const handleSwitch = async (id: string): Promise<void> => {
    if (switchingId || id === currentId) return
    setSwitchError(null)
    setSwitchingId(id)
    try {
      await window.profiles.switch(id)
      window.location.reload()
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : String(err))
      setSwitchingId(null)
      await refreshUser()
    }
  }

  return (
    <div>
      <h3 className="m-0 text-wm-md font-medium text-fg">{t('settings.profiles.title')}</h3>
      <p className="mt-1.5 text-wm-sm text-fg-muted">{t('settings.profiles.subtitle')}</p>

      {loadError ? (
        <p className="mt-2 text-wm-sm text-negative">{loadError}</p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {(profiles ?? []).map((profile) => {
            const isCurrent = profile.id === currentId
            return (
              <li
                key={profile.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface-2 px-3 py-2"
              >
                <span className="text-wm-sm text-fg">
                  {profile.name}
                  {isCurrent && (
                    <span className="ml-2 text-wm-xs text-fg-muted">{t('settings.profiles.current')}</span>
                  )}
                </span>
                {!isCurrent && (
                  <Button
                    variant="subtle"
                    size="sm"
                    disabled={switchingId !== null}
                    onClick={() => void handleSwitch(profile.id)}
                  >
                    {switchingId === profile.id ? t('common.pleaseWait') : t('settings.profiles.switch')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {switchError && <p className="mt-2 text-wm-sm text-negative">{switchError}</p>}
    </div>
  )
}
