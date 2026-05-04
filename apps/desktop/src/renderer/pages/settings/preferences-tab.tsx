import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AiCategorizationMode,
  AppLocale,
  ChartDateMode,
  User,
  UpdateUserMeRequest,
} from '@wimm/shared'
import { useAuth } from '../../context/auth-context'
import { apiClient } from '../../lib/api-client'
import { Button } from '../../components/ui/button'
import { ChartDateModeToggle } from '../../components/ui/chart-date-mode-toggle'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { Select } from '../../components/ui/select'

export function PreferencesTab(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [byokInput, setByokInput] = useState('')
  const [byokError, setByokError] = useState<string | null>(null)

  const user = state.status === 'authenticated' ? state.user : null
  const value = user?.preferredLocale ?? 'pt'
  const chartMode: ChartDateMode = user?.chartDateMode ?? 'BILLING_CYCLE'
  const aiMode: AiCategorizationMode = user?.aiCategorizationMode ?? 'OFF'
  const hasAiKey = user?.hasAiApiKey ?? false

  const patchMe = async (body: UpdateUserMeRequest): Promise<void> => {
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

  const onAiModeChange = (next: AiCategorizationMode): void => {
    void patchMe({ aiCategorizationMode: next })
  }

  const onSaveByokKey = async (): Promise<void> => {
    setByokError(null)
    const trimmed = byokInput.trim()
    if (!trimmed.startsWith('sk-ant-')) {
      setByokError(t('settings.aiKeyInvalid'))
      return
    }
    try {
      await patchMe({ aiApiKey: trimmed, aiCategorizationMode: 'BYOK' })
      setByokInput('')
    } catch {
      setByokError(t('settings.aiKeyFailed'))
    }
  }

  const onClearByokKey = async (): Promise<void> => {
    await patchMe({ aiApiKey: null })
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

        <div>
          <h3 className="m-0 text-wm-md font-medium text-fg">
            {t('settings.aiTitle')}
          </h3>
          <p className="mt-1.5 text-wm-sm leading-relaxed text-fg-muted">
            {t('settings.aiSubtitle')}
          </p>
        </div>

        <Field label={t('settings.aiMode')} hint={t('settings.aiModeHint')}>
          <Select
            value={aiMode}
            onChange={(v) => onAiModeChange(v as AiCategorizationMode)}
            disabled={pending || !user}
            options={[
              { value: 'OFF', label: t('settings.aiModeOff') },
              { value: 'SERVER', label: t('settings.aiModeServer') },
              { value: 'BYOK', label: t('settings.aiModeByok') },
            ]}
            ariaLabel={t('settings.aiMode')}
          />
        </Field>

        {aiMode === 'BYOK' ? (
          <Field
            label={t('settings.aiKeyLabel')}
            hint={t('settings.aiKeyHint')}
          >
            <div className="flex flex-col gap-2">
              {hasAiKey ? (
                <div className="flex items-center justify-between rounded-sm border border-line bg-surface-2 px-3 py-2 text-wm-sm">
                  <span className="text-fg">{t('settings.aiKeyConfigured')}</span>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => void onClearByokKey()}
                    disabled={pending}
                  >
                    {t('settings.aiKeyClear')}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={byokInput}
                    onChange={(e) => setByokInput(e.target.value)}
                    placeholder="sk-ant-..."
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 rounded-sm border border-line bg-surface-2 px-3 py-2 text-wm-sm font-mono text-fg focus:border-accent focus:outline-none"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void onSaveByokKey()}
                    disabled={pending || byokInput.trim().length < 20}
                  >
                    {t('settings.aiKeySave')}
                  </Button>
                </div>
              )}
              {byokError ? (
                <p className="m-0 text-wm-sm text-negative">{byokError}</p>
              ) : null}
            </div>
          </Field>
        ) : null}

        {error ? (
          <p className="m-0 text-wm-sm text-negative">{error}</p>
        ) : null}
      </div>
    </Panel>
  )
}
