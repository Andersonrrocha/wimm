import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AiByokSource,
  AiCategorizationMode,
  ChartDateMode,
  User,
  UpdateUserMeRequest,
} from '@wimm/shared'
import { useAuth } from '../../context/auth-context'
import { apiClient } from '../../lib/api-client'
import { Button } from '../../components/ui/button'
import { ChartDateModeToggle } from '../../components/ui/chart-date-mode-toggle'
import { ChatGptConnection } from '../../components/settings/chatgpt-connection'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { ProfileBackupsSection } from '../../components/profile-backups'
import { ProfileSwitcher } from '../../components/profile-switcher'
import { Select } from '../../components/ui/select'
import { useChatGptStatus } from '../../lib/use-chatgpt-status'

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
  const byokSource: AiByokSource | null = user?.aiByokSource ?? null

  // The second own-credential source, read from the one query that already
  // owns `/ai/chatgpt/status` -- see `useChatGptStatus`. No new route: the
  // two payloads the renderer already holds say everything the choice needs.
  const chatGptConnected = useChatGptStatus().data?.connected ?? false

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

  const onByokSourceChange = (next: string): void => {
    if (next !== 'ANTHROPIC_KEY' && next !== 'CHATGPT_PLAN') return
    void patchMe({ aiByokSource: next })
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

        {/* Shown only when the choice is real. With one own credential
            available `AiCategorizerSelector` uses it without asking and
            ignores any stored value, so a selector here would be a control
            that changes nothing: it would offer a source the user does not
            have and then read back as though picking it had taken effect.
            Both conditions come from payloads the renderer already holds --
            `hasAiApiKey` on the user, `connected` on the ChatGPT status. */}
        {aiMode === 'BYOK' && hasAiKey && chatGptConnected ? (
          <Field
            label={t('settings.aiByokSourceLabel')}
            hint={t('settings.aiByokSourceHint')}
          >
            <Select
              value={byokSource ?? ''}
              onChange={onByokSourceChange}
              disabled={pending || !user}
              placeholder={t('settings.aiByokSourcePlaceholder')}
              options={[
                // "Not chosen yet" as the first option, not as Radix's
                // placeholder. `Select` maps `''` to an internal token
                // before handing it to Radix, and Radix shows the
                // placeholder only for `''` or `undefined` -- so with no
                // option carrying `''` the trigger rendered neither the
                // placeholder nor a matching item, i.e. blank, in exactly
                // the state this control exists for. Same shape as
                // `imports-page.tsx` and `recurrences-page.tsx`.
                // `disabled` keeps it unselectable, so
                // `onByokSourceChange`'s enum guard stays the only writer.
                {
                  value: '',
                  label: t('settings.aiByokSourcePlaceholder'),
                  disabled: true,
                },
                {
                  value: 'ANTHROPIC_KEY',
                  label: t('settings.aiByokSourceAnthropicKey'),
                },
                {
                  value: 'CHATGPT_PLAN',
                  label: t('settings.aiByokSourceChatGptPlan'),
                },
              ]}
              ariaLabel={t('settings.aiByokSourceLabel')}
            />
          </Field>
        ) : null}

        {/* The second credential source, beside the Anthropic key field.
            `BYOK` means "one of my own credentials" and there are two kinds;
            `ChatGptConnectFlow` sets `OFF` to `BYOK` on a successful connect
            for exactly that reason. Rendered outside the `BYOK` branch above
            rather than inside it so that a connection left live under `OFF`
            can still say so -- see the component's own doc comment. */}
        <ChatGptConnection
          aiMode={aiMode}
          hasAnthropicKey={hasAiKey}
          byokSource={byokSource}
        />

        {error ? (
          <p className="m-0 text-wm-sm text-negative">{error}</p>
        ) : null}

        {/* Renders nothing in hosted mode, and nothing at all when there is
            only one profile to begin with -- see ProfileSwitcher's own doc
            comment. */}
        <ProfileSwitcher />

        {/* Renders nothing in hosted mode -- see ProfileBackupsSection's own
            doc comment. Export/restore (Phase 4c task 4). */}
        <ProfileBackupsSection />
      </div>
    </Panel>
  )
}
