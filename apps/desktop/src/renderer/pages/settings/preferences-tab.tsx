import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLocale, User } from '@wimm/shared'
import { useAuth } from '../../context/auth-context'
import { apiClient } from '../../lib/api-client'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { Select } from '../../components/ui/select'

export function PreferencesTab(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const user = state.status === 'authenticated' ? state.user : null
  const value = user?.preferredLocale ?? 'pt'

  const onLocaleChange = async (next: string): Promise<void> => {
    if (next !== 'en' && next !== 'pt') return
    setError(null)
    setPending(true)
    try {
      await apiClient.patch<User>('/users/me', {
        preferredLocale: next as AppLocale,
      })
      await refreshUser()
    } catch {
      setError(t('quickAdd.couldNotSave'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel>
      <div className="flex max-w-md flex-col gap-4">
        <div>
          <h2 className="m-0 text-wm-md font-medium text-fg">
            {t('settings.preferencesTitle')}
          </h2>
          <p className="mt-1.5 text-wm-sm text-fg-muted">
            {t('settings.preferencesSubtitle')}
          </p>
        </div>
        <Field
          label={t('settings.language')}
          hint={t('settings.languageHint')}
        >
          <Select
            value={value}
            onChange={(v) => void onLocaleChange(v)}
            disabled={pending || !user}
            options={[
              { value: 'pt', label: t('settings.localePt') },
              { value: 'en', label: t('settings.localeEn') },
            ]}
            ariaLabel={t('settings.language')}
          />
        </Field>
        {error ? (
          <p className="m-0 text-wm-sm text-negative">{error}</p>
        ) : null}
      </div>
    </Panel>
  )
}
