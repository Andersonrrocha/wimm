/**
 * Wire contract for the profile lifecycle IPC surface (`profiles:*`),
 * shared between the renderer (the gate/onboarding/picker screens), the
 * preload bridge (which only relays these shapes, never inspects them),
 * and main (`index.ts`, which decides the real situation via
 * `profile-lifecycle.ts`'s `resolveProfileSituation`).
 *
 * **Deliberately no `corrupt-registry` case here.** `ProfileSituation` in
 * `profile-lifecycle.ts` has four cases; this wire type only has three.
 * A corrupt registry is not a state the renderer is ever asked to render --
 * main handles it before any window exists at all (a blocking native
 * dialog naming the problem, then quit; see `index.ts`'s `runApp`), the
 * same way it already handles `NewerDatabaseError` and every other boot
 * failure that predates this task. That is a deliberate design choice, not
 * an omission: it makes "show the corrupt-registry case as if it were
 * no-profiles" structurally impossible on the renderer side, because the
 * renderer never receives a message that could be mishandled that way in
 * the first place. See `profile-lifecycle.spec.ts`'s mutation-proof note
 * for where the actual zero/one/several/corrupt distinction is guarded.
 *
 * `ProfileSummary` is a slimmed-down `Profile` (`@wimm/api`'s
 * `profile-registry.ts`): no `dbFileName`. The renderer never needs to know
 * how a profile's database file is named on disk, so this boundary does
 * not hand it that detail even though it is not itself sensitive.
 */

/** A profile as shown to the user in the picker -- name and metadata only, never a filesystem path. */
export interface ProfileSummary {
  id: string
  name: string
  createdAt: string
  lastOpenedAt: string | null
}

/**
 * What `profiles:get-situation` reports. `'ready'` means a profile is
 * already open (or in the process of opening) and the renderer should
 * proceed to the normal app -- `local-api:get-mode` will report `'local'`
 * once it does. `'no-profiles'` and `'multiple-profiles'` are exactly
 * `profile-lifecycle.ts`'s same-named `ProfileSituation` cases, serialized
 * for IPC.
 */
export type ProfilesSituationPayload =
  | { kind: 'ready' }
  | { kind: 'no-profiles' }
  | { kind: 'multiple-profiles'; profiles: ProfileSummary[] }
