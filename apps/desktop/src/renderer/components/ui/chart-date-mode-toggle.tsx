import { useTranslation } from 'react-i18next'
import type { ChartDateMode } from '@wimm/shared'

/**
 * Two-option segmented toggle for `chartDateMode`. Used in onboarding step 2
 * and in the preferences tab.
 */
export function ChartDateModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ChartDateMode
  onChange: (next: ChartDateMode) => void
  disabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const opts: Array<{ value: ChartDateMode; label: string }> = [
    { value: 'BILLING_CYCLE', label: t('onboarding.modeBillingCycle') },
    { value: 'PURCHASE_DATE', label: t('onboarding.modePurchaseDate') },
  ]
  return (
    <div
      role="radiogroup"
      aria-label={t('onboarding.modeAria')}
      className="grid grid-cols-2 gap-2"
    >
      {opts.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-sm border px-3 py-2 text-wm-sm transition-colors ${
              active
                ? 'border-accent bg-surface-2 text-fg'
                : 'border-line bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
