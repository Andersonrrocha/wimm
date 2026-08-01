import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthBrand } from './auth-brand'
import { Button } from './ui/button'
import { Field } from './ui/field'
import { Input } from './ui/input'
import { authCardClassName, authScreenClassName } from '../lib/auth-screen-classes'

const PROFILE_NAME_MAX_LENGTH = 60

type ProfileOnboardingScreenProps = {
  /** Called after `window.profiles.create` succeeds, to let `ProfileGate` re-check the situation (now `'ready'`). */
  onCreated: () => void | Promise<void>
}

/**
 * Shown when `profiles:get-situation` reports `'no-profiles'` -- the very
 * first launch, or every profile having been removed some other way. Asks
 * for a name and creates the first profile via `window.profiles.create`,
 * which crosses into main's `profiles:create` handler
 * (`main/index.ts`) -> `createProfileAndOpen` (`main/local-api.ts`), the
 * only place that actually validates the name (`validateProfileName`,
 * `main/profile-lifecycle.ts`) and generates the profile's `id` -- this
 * component sends the raw text the user typed and nothing else.
 */
export function ProfileOnboardingScreen({ onCreated }: ProfileOnboardingScreenProps): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await window.profiles.create(name)
      await onCreated()
    } catch (err) {
      // `err.message` here is whatever main's `profiles:create` handler
      // threw -- `InvalidProfileNameError`'s message for a bad name, or a
      // real boot failure's message otherwise. Shown as-is, the same way
      // `login-page.tsx`/`register-page.tsx` show a backend error: it is
      // already a short, human sentence, not a stack trace.
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  return (
    <div className={authScreenClassName}>
      <div className={authCardClassName}>
        <AuthBrand />
        <h1 className="text-center text-wm-lg font-medium text-fg">
          {t('profiles.onboarding.title')}
        </h1>
        <p className="mb-2 text-center text-wm-sm text-fg-muted">
          {t('profiles.onboarding.body')}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <Field label={t('profiles.onboarding.nameLabel')}>
            <Input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('profiles.onboarding.namePlaceholder')}
              maxLength={PROFILE_NAME_MAX_LENGTH}
              required
            />
          </Field>
          {error && <p className="m-0 text-center text-wm-sm text-negative">{error}</p>}
          <Button
            type="submit"
            variant="primary"
            disabled={loading || name.trim().length === 0}
            block
            className="mt-1"
          >
            {loading ? t('common.pleaseWait') : t('profiles.onboarding.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
