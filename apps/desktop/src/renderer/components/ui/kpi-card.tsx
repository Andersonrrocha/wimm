import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface KpiCardProps {
  label: string
  value: string
  hint?: ReactNode
  /** Main accent color for the value text; defaults to plain foreground. */
  tone?: 'default' | 'positive' | 'negative' | 'accent'
  /** Optional decorative indicator rendered at top-right (e.g., trend chip). */
  adornment?: ReactNode
  loading?: boolean
}

const toneClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
  default: 'text-fg',
  positive: 'text-positive',
  negative: 'text-negative',
  accent: 'text-accent',
}

/**
 * High-density KPI card used on the dashboard. Keeps numbers tabular,
 * uses one-line label in caps and a large value below.
 */
export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
  adornment,
  loading,
}: KpiCardProps): JSX.Element {
  return (
    <div className="flex min-h-[116px] flex-col gap-2 rounded-md border border-line-soft bg-surface-1 px-5 pb-4 pt-[18px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-wm-xs uppercase tracking-label text-fg-muted">
          {label}
        </span>
        {adornment}
      </div>
      <div
        className={cn(
          'font-semibold tabular-nums',
          'text-[1.7rem] leading-[1.1] tracking-[-0.02em]',
          toneClass[tone],
        )}
      >
        {loading ? '—' : value}
      </div>
      {hint ? (
        <div className="flex items-center gap-1.5 text-wm-xs text-fg-muted">
          {hint}
        </div>
      ) : null}
    </div>
  )
}
