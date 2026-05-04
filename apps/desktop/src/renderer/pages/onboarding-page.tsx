import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { ChartDateMode, User } from '@wimm/shared'
import { useAuth } from '../context/auth-context'
import { apiClient } from '../lib/api-client'
import { AuthBrand } from '../components/auth-brand'
import { Button } from '../components/ui/button'
import { ChartDateModeToggle } from '../components/ui/chart-date-mode-toggle'
import {
  authCardClassName,
  authScreenClassName,
} from '../lib/auth-screen-classes'

const STEPS = 3

/**
 * Three-screen first-run flow shown when `user.onboardedAt === null`.
 *
 *  1. Welcome — pitch import-based + privacy
 *  2. Billing cycle explainer with inline mode toggle (the WIMM differentiator)
 *  3. Confirmation + CTA into the dashboard
 *
 * Anything the user touches in step 2 is committed in `finish` along with
 * the `onboardedAt` mark, then we refresh the auth user so subsequent reports
 * pick up the new mode.
 */
export function OnboardingPage(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const navigate = useNavigate()
  const initial: ChartDateMode =
    state.status === 'authenticated'
      ? state.user.chartDateMode
      : 'BILLING_CYCLE'
  const [mode, setMode] = useState<ChartDateMode>(initial)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const finish = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (mode !== initial) {
        await apiClient.patch<User>('/users/me', { chartDateMode: mode })
      }
      await apiClient.post<User>('/users/me/onboarded')
      await refreshUser()
      navigate('/', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={authScreenClassName}>
      <div className={`${authCardClassName} max-w-[440px] gap-5`}>
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: STEPS }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-pill transition-colors ${
                i <= step ? 'bg-accent' : 'bg-line'
              }`}
              aria-hidden
            />
          ))}
        </div>

        {step === 0 && <WelcomeStep />}

        {step === 1 && <BillingCycleStep mode={mode} onChange={setMode} />}

        {step === 2 && <ReadyStep />}

        <div className="flex items-center justify-between gap-3 pt-2">
          {step > 0 ? (
            <Button
              variant="subtle"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={busy}
            >
              {t('onboarding.back')}
            </Button>
          ) : (
            <span aria-hidden />
          )}
          {step < STEPS - 1 ? (
            <Button
              variant="primary"
              onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}
            >
              {t('onboarding.next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()} disabled={busy}>
              {busy ? t('common.saving') : t('onboarding.getStarted')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function WelcomeStep(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <AuthBrand />
      <h1 className="m-0 text-wm-lg font-medium text-fg">
        {t('onboarding.welcomeTitle')}
      </h1>
      <p className="m-0 text-wm-sm leading-relaxed text-fg-muted">
        {t('onboarding.welcomeBody')}
      </p>
    </div>
  )
}

function BillingCycleStep({
  mode,
  onChange,
}: {
  mode: ChartDateMode
  onChange: (next: ChartDateMode) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-wm-lg font-medium text-fg">
        {t('onboarding.billingTitle')}
      </h1>
      <p className="m-0 text-wm-sm leading-relaxed text-fg-muted">
        {t('onboarding.billingBody')}
      </p>
      <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2 p-3 text-wm-xs text-fg-muted">
        <div className="flex items-center justify-between">
          <span>{t('onboarding.billingExampleSpentLabel')}</span>
          <span className="text-fg">R$ 200 — May 5</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('onboarding.billingExampleOtherApps')}</span>
          <span className="text-fg-muted">May</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('onboarding.billingExampleWimm')}</span>
          <span className="text-accent">June</span>
        </div>
      </div>
      <ChartDateModeToggle value={mode} onChange={onChange} />
    </div>
  )
}

function ReadyStep(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="m-0 text-wm-lg font-medium text-fg">
        {t('onboarding.readyTitle')}
      </h1>
      <p className="m-0 text-wm-sm leading-relaxed text-fg-muted">
        {t('onboarding.readyBody')}
      </p>
    </div>
  )
}

