import type { CSSProperties, ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: string
  hint?: ReactNode
  /** main accent color for the value text; falls back to default text */
  tone?: 'default' | 'positive' | 'negative' | 'accent'
  /** optional decorative indicator rendered at top-right (e.g., trend chip) */
  adornment?: ReactNode
  loading?: boolean
}

const toneToColor = (tone: KpiCardProps['tone']): string | undefined => {
  switch (tone) {
    case 'positive':
      return 'var(--wm-positive)'
    case 'negative':
      return 'var(--wm-negative)'
    case 'accent':
      return 'var(--wm-accent)'
    default:
      return undefined
  }
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
  const valueColor = toneToColor(tone)
  return (
    <div className="wm-surface" style={cardStyle}>
      <div style={headerStyle}>
        <span className="wm-label">{label}</span>
        {adornment}
      </div>
      <div
        className="wm-num"
        style={{
          ...valueStyle,
          color: valueColor ?? 'var(--wm-text)',
        }}
      >
        {loading ? '—' : value}
      </div>
      {hint ? <div style={hintStyle}>{hint}</div> : null}
    </div>
  )
}

const cardStyle: CSSProperties = {
  padding: '18px 20px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 116,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const valueStyle: CSSProperties = {
  fontSize: '1.7rem',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
}

const hintStyle: CSSProperties = {
  fontSize: 'var(--wm-fs-xs)',
  color: 'var(--wm-text-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
