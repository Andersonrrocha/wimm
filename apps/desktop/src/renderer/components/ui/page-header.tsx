import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

/**
 * Consistent page header used across top-level routes.
 *
 * Reference implementation for the Tailwind migration: every style here uses
 * utilities backed by our design tokens (`tailwind.config.ts` → `--wm-*`).
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: PageHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1.5 text-wm-xs uppercase tracking-label text-fg-muted">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-wm-2xl font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-[62ch] text-wm-sm text-fg-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
