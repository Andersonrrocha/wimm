import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfileSummary } from '../../shared/profile-protocol'
import { AuthBrand } from './auth-brand'
import { Button } from './ui/button'
import { authCardClassName, authScreenClassName } from '../lib/auth-screen-classes'

type ProfilePickerScreenProps = {
  profiles: ProfileSummary[]
  /** Called after `window.profiles.open` succeeds, to let `ProfileGate` re-check the situation (now `'ready'`). */
  onOpened: () => void | Promise<void>
}

/**
 * Shown when `profiles:get-situation` reports `'multiple-profiles'`. Never
 * guesses which one to open (see `local-api.ts`'s module doc comment for
 * why the old "most recently used" auto-pick was scaffolding, not a real
 * design) -- every profile is listed, and opening one is always an explicit
 * click.
 *
 * `profile.id` is what's sent to `window.profiles.open`; main re-reads the
 * registry itself to confirm that id still names a real profile before
 * opening anything (`profiles:open`, `main/index.ts`) -- this screen's own
 * `profiles` list, passed down at mount, is never trusted as proof that the
 * id is still valid.
 */
export function ProfilePickerScreen({ profiles, onOpened }: ProfilePickerScreenProps): JSX.Element {
  const { t } = useTranslation()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleOpen = async (id: string): Promise<void> => {
    if (openingId) return
    setError(null)
    setOpeningId(id)
    try {
      await window.profiles.open(id)
      await onOpened()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOpeningId(null)
    }
  }

  return (
    <div className={authScreenClassName}>
      <div className={authCardClassName}>
        <AuthBrand />
        <h1 className="text-center text-wm-lg font-medium text-fg">
          {t('profiles.picker.title')}
        </h1>
        <p className="mb-2 text-center text-wm-sm text-fg-muted">
          {t('profiles.picker.body')}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Button
                type="button"
                variant="ghost"
                block
                disabled={openingId !== null}
                onClick={() => void handleOpen(profile.id)}
              >
                {openingId === profile.id ? t('common.pleaseWait') : profile.name}
              </Button>
            </li>
          ))}
        </ul>
        {error && <p className="m-0 text-center text-wm-sm text-negative">{error}</p>}
      </div>
    </div>
  )
}
