import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  active?: boolean
}

/**
 * Small pill-shaped toggle. Uses `aria-selected` for a11y state.
 */
export function Chip({
  children,
  active,
  className,
  type = 'button',
  ...rest
}: ChipProps): JSX.Element {
  return (
    <button
      type={type}
      aria-selected={active || undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-wm-xs',
        'transition duration-wm-fast ease-wm',
        active
          ? 'border-accent bg-accent-soft text-fg'
          : 'border-line-soft bg-surface-1 text-fg-muted hover:border-line hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
