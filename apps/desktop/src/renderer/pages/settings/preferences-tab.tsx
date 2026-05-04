import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLocale, ChartDateMode, User } from '@wimm/shared'
import { useAuth } from '../../context/auth-context'
import { apiClient } from '../../lib/api-client'
import { ChartDateModeToggle } from '../../components/ui/chart-date-mode-toggle'
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
  const chartMode: ChartDateMode = user?.chartDateMode ?? 'BILLING_CYCLE'

  const patchMe = async (
    body: { preferredLocale?: AppLocale; chartDateMode?: ChartDateMode },
  ): Promise<void> => {
    setError(null)
    setPending(true)
    try {
      await apiClient.patch<User>('/users/me', body)
      await refreshUser()
    } catch {
      setError(t('quickAdd.couldNotSave'))
    } finally {
      setPending(false)
    }
  }

  const onLocaleChange = (next: string): void => {
    if (next !== 'en' && next !== 'pt') return
    void patchMe({ preferredLocale: next })
  }

  const onModeChange = (next: ChartDateMode): void => {
    void patchMe({ chartDateMode: next })
  }

  return (
    <Panel>
      <div className="flex max-w-md flex-col gap-5">
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
            onChange={onLocaleChange}
            disabled={pending || !user}
            options={[
              { value: 'pt', label: t('settings.localePt') },
              { value: 'en', label: t('settings.localeEn') },
            ]}
            ariaLabel={t('settings.language')}
          />
        </Field>
        <Field
          label={t('settings.chartDateMode')}
          hint={t('settings.chartDateModeHint')}
        >
          <ChartDateModeToggle
            value={chartMode}
            onChange={onModeChange}
            disabled={pending || !user}
          />
        </Field>
        {error ? (
          <p className="m-0 text-wm-sm text-negative">{error}</p>
        ) : null}
      </div>
    </Panel>
  )
}
