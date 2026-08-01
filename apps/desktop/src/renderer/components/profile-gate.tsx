import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProfileSummary, ProfilesSituationPayload } from '../../shared/profile-protocol'
import { ProfileOnboardingScreen } from './profile-onboarding-screen'
import { ProfilePickerScreen } from './profile-picker-screen'

type GateState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'no-profiles' }
  | { status: 'multiple-profiles'; profiles: ProfileSummary[] }

function toGateState(payload: ProfilesSituationPayload): GateState {
  if (payload.kind === 'no-profiles') return { status: 'no-profiles' }
  if (payload.kind === 'multiple-profiles') {
    return { status: 'multiple-profiles', profiles: payload.profiles }
  }
  return { status: 'ready' }
}

/**
 * Renders in front of the entire app -- `App.tsx` wraps its whole tree in
 * this. Decides, on mount, whether local mode already has a profile open
 * (`'ready'`) or needs the user to create the first one (`'no-profiles'`)
 * or choose among several (`'multiple-profiles'`), by asking main's
 * `profiles:get-situation` handler (`main/index.ts`), which in turn is
 * exactly `profile-lifecycle.ts`'s `resolveProfileSituation` -- the same
 * pure zero/one/several/corrupt decision `profile-lifecycle.spec.ts`
 * exercises directly. A **corrupt** registry never reaches this component
 * at all: main shows a native dialog and quits before any window (and
 * therefore before this component) exists -- see `profile-protocol.ts`'s
 * doc comment for why that is deliberate, not an oversight.
 *
 * **`children` never mounts before this resolves to `'ready'`.** That
 * matters beyond just "don't show the wrong screen": `api-mode.ts`'s
 * `resolveApiMode` (which `AuthProvider`, inside `children`, calls on its
 * own mount) caches its answer for the life of the renderer after the
 * *first* call. If `AuthProvider` mounted while a profile was still being
 * chosen or created, it would ask `local-api:get-mode` before main had set
 * `localApiHandle`, cache `'hosted'`, and never see `'local'` again for the
 * rest of this session -- even after the user actually opens a profile.
 * Keeping `children` out of the tree entirely until `'ready'` is what
 * prevents that, rather than relying on every future caller of
 * `resolveApiMode` to remember not to run too early.
 *
 * `window.profiles` is absent outside Electron's preload context. Treated
 * the same defensive way `api-mode.ts`'s `resolveApiMode` treats a missing
 * `source`: fall through to `'ready'` immediately, the state that needs
 * nothing else to already exist.
 */
export function ProfileGate({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<GateState>({ status: 'loading' })

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.profiles) {
      setState({ status: 'ready' })
      return
    }
    const payload = await window.profiles.getSituation()
    setState(toGateState(payload))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (state.status === 'loading') {
    return <ProfileGateLoadingScreen />
  }
  if (state.status === 'no-profiles') {
    return <ProfileOnboardingScreen onCreated={refresh} />
  }
  if (state.status === 'multiple-profiles') {
    return <ProfilePickerScreen profiles={state.profiles} onOpened={refresh} />
  }
  return <>{children}</>
}

function ProfileGateLoadingScreen(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-app">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
    </div>
  )
}
