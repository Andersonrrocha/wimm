import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

/** Consistent page header used across top-level routes. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: PageHeaderProps): JSX.Element {
  return (
    <header className="wm-page-header">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div className="wm-page-eyebrow">{eyebrow}</div> : null}
        <h1 className="wm-page-title">{title}</h1>
        {subtitle ? <p className="wm-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="wm-page-actions">{actions}</div> : null}
    </header>
  )
}
