import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Placeholder shown when a list or table has no data. Left-aligned and
 * muted by default; compose action buttons or hints inside.
 */
export function EmptyState({
  children,
  className,
  ...rest
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 py-5 text-wm-sm text-fg-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
