import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeVariant =
  | 'neutral'
  | 'positive'
  | 'negative'
  | 'accent'
  | 'warning'
  | 'info'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  variant?: BadgeVariant
}

const base =
  'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 ' +
  'text-wm-xs font-medium uppercase tracking-[0.04em] whitespace-nowrap'

const variants: Record<BadgeVariant, string> = {
  neutral: 'border-line-soft bg-surface-2 text-fg-muted',
  positive: 'border-transparent bg-positive-soft text-positive',
  negative: 'border-transparent bg-negative-soft text-negative',
  accent: 'border-transparent bg-accent-soft text-accent',
  warning: 'border-transparent bg-[rgba(255,198,109,0.12)] text-warning',
  info: 'border-transparent bg-info-soft text-info',
}

/**
 * Small pill-shaped label. Default `neutral` variant suits "muted tag";
 * use `positive`/`negative` for trends, `accent`/`warning`/`info` for
 * emphasis.
 */
export function Badge({
  children,
  variant = 'neutral',
  className,
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span className={cn(base, variants[variant], className)} {...rest}>
      {children}
    </span>
  )
}
