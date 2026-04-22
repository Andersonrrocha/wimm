import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Remove default padding (useful when wrapping tables that are edge-to-edge). */
  flush?: boolean
}

/**
 * Section card used across pages. Composes with `Panel.Header`,
 * `Panel.Title`, `Panel.Subtitle`.
 */
export function Panel({
  children,
  flush,
  className,
  ...rest
}: PanelProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-3.5 rounded-md border border-line-soft bg-surface-1',
        flush ? 'p-0' : 'p-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

Panel.Header = function PanelHeader({
  children,
  className,
  ...rest
}: PanelHeaderProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

Panel.Title = function PanelTitle({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return (
    <h2
      className={cn(
        'text-wm-lg font-semibold leading-tight tracking-tight',
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  )
}

Panel.Subtitle = function PanelSubtitle({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return (
    <p
      className={cn('mt-0.5 text-wm-xs text-fg-muted', className)}
      {...rest}
    >
      {children}
    </p>
  )
}
