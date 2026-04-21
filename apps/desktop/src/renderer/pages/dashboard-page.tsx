import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type CSSProperties } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  CategoryReportRow,
  PaginatedResponse,
  ReportByCategoryResponse,
  ReportMonthlyResponse,
  ReportSummaryResponse,
  Transaction,
} from '@wimm/shared'
import { useAuth } from '../context/auth-context'
import { apiClient } from '../lib/api-client'
import type { QuickAddTab } from '../components/quick-add-modal'
import { DatePicker } from '../components/ui/date-picker'
import { Select } from '../components/ui/select'
import {
  computeRange,
  formatShortDate,
  type RangePreset,
} from '../lib/dates'

const YEAR_NOW = new Date().getFullYear()
const yearOptions = Array.from({ length: 7 }, (_, i) => YEAR_NOW - 5 + i).map(
  (y) => ({ value: String(y), label: String(y) }),
)

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

type PresetId = RangePreset | 'custom'

type Range = { from: string; to: string; preset: PresetId }

function computePreset(preset: RangePreset): Range {
  const r = computeRange(preset)
  return { ...r, preset }
}

function formatMoney(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (Number.isNaN(n)) return String(amount)
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return Math.round(n).toString()
}

const DONUT_COLORS = [
  'var(--wm-chart-1)',
  'var(--wm-chart-2)',
  'var(--wm-chart-4)',
  'var(--wm-chart-6)',
  'var(--wm-chart-5)',
  'var(--wm-chart-3)',
  'var(--wm-chart-other)',
]

export function DashboardPage(): JSX.Element {
  const { state } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const { openQuickAdd } = useOutletContext<OutletCtx>()

  const [range, setRange] = useState<Range>(() => computePreset('mtd'))
  const [trendYear, setTrendYear] = useState(() => new Date().getFullYear())

  const params = useMemo(
    () => ({ from: range.from, to: range.to }),
    [range.from, range.to],
  )

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['reports', 'summary', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportSummaryResponse>(
        '/reports/summary',
        { params },
      )
      return data
    },
  })

  const { data: byCategory, isLoading: loadingByCat } = useQuery({
    queryKey: ['reports', 'by-category', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportByCategoryResponse>(
        '/reports/by-category',
        { params },
      )
      return data
    },
  })

  const { data: monthly, isLoading: loadingMonthly } = useQuery({
    queryKey: ['reports', 'monthly', trendYear],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportMonthlyResponse>(
        '/reports/monthly',
        { params: { year: trendYear } },
      )
      return data
    },
  })

  const { data: recentList, isLoading: loadingRecent } = useQuery({
    queryKey: ['transactions', 'recent', params],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<Transaction>>(
        '/transactions',
        { params: { ...params, page: 1, pageSize: 6 } },
      )
      return data
    },
  })

  const expensesInRange = useMemo(
    () => (byCategory?.items ?? []).filter((r) => r.kind === 'EXPENSE'),
    [byCategory],
  )

  const donutData = useMemo(() => {
    if (expensesInRange.length === 0) return []
    const sorted = [...expensesInRange].sort(
      (a, b) => Number.parseFloat(b.total) - Number.parseFloat(a.total),
    )
    const top = sorted.slice(0, 5)
    const tail = sorted.slice(5)
    const base = top.map((r) => ({
      name: r.name,
      value: Number.parseFloat(r.total),
    }))
    if (tail.length === 0) return base
    const otherTotal = tail.reduce(
      (s, r) => s + Number.parseFloat(r.total),
      0,
    )
    return [...base, { name: `Other (${tail.length})`, value: otherTotal }]
  }, [expensesInRange])

  const topCategories = useMemo(() => {
    return [...expensesInRange]
      .sort(
        (a, b) => Number.parseFloat(b.total) - Number.parseFloat(a.total),
      )
      .slice(0, 6)
  }, [expensesInRange])

  const topCategoriesMax = useMemo(() => {
    if (topCategories.length === 0) return 0
    return Math.max(
      ...topCategories.map((r) => Number.parseFloat(r.total)),
      0,
    )
  }, [topCategories])

  const monthlyData = useMemo(() => {
    return (monthly?.months ?? []).map((m) => ({
      label: m.label,
      income: Number.parseFloat(m.income),
      expense: Number.parseFloat(m.expense),
      net: Number.parseFloat(m.net),
    }))
  }, [monthly])

  const cumulativeYear = useMemo(() => {
    let acc = 0
    return monthlyData.map((m) => {
      acc += m.net
      return { label: m.label, cumulative: acc }
    })
  }, [monthlyData])

  const summaryIncome = Number.parseFloat(summary?.income ?? '0')
  const summaryExpense = Number.parseFloat(summary?.expense ?? '0')
  const summaryNet = Number.parseFloat(summary?.net ?? '0')
  const savingsRate =
    summaryIncome > 0 ? (summaryNet / summaryIncome) * 100 : null

  const presetLabel = (id: PresetId): string =>
    id === 'mtd'
      ? 'This month'
      : id === 'last30'
        ? 'Last 30 days'
        : id === 'ytd'
          ? 'Year to date'
          : 'Custom'

  const applyPreset = (id: Exclude<PresetId, 'custom'>): void => {
    setRange(computePreset(id))
  }

  const updateRange = (patch: Partial<Range>): void => {
    setRange((r) => ({ ...r, ...patch, preset: 'custom' }))
  }

  return (
    <div style={styles.wrap}>
      <header style={styles.pageHeader}>
        <div>
          <div style={styles.pageEyebrow}>
            {user
              ? `Welcome back, ${user.username}`
              : 'Welcome back'}
          </div>
          <h1 style={styles.h1}>Overview</h1>
          <p style={styles.sub}>
            {presetLabel(range.preset)} · {formatShortDate(range.from)} →{' '}
            {formatShortDate(range.to)}
          </p>
        </div>

        <div style={styles.controls}>
          <div role="group" aria-label="Quick range" style={styles.chipsRow}>
            {(['mtd', 'last30', 'ytd'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`wm-chip${range.preset === p ? ' wm-chip--active' : ''}`}
                onClick={() => applyPreset(p)}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>
          <div style={styles.rangeInputs}>
            <DatePicker
              value={range.from}
              onChange={(v) => updateRange({ from: v })}
              ariaLabel="From"
              minWidth={148}
            />
            <span style={styles.dash}>→</span>
            <DatePicker
              value={range.to}
              onChange={(v) => updateRange({ to: v })}
              ariaLabel="To"
              minWidth={148}
            />
          </div>
        </div>
      </header>

      {/* KPIs */}
      <section style={styles.kpiGrid}>
        <KpiCard
          label="Income"
          value={formatMoney(summaryIncome)}
          tone="positive"
          loading={loadingSummary}
          hint="Sum of incoming transactions"
        />
        <KpiCard
          label="Expense"
          value={formatMoney(summaryExpense)}
          tone="negative"
          loading={loadingSummary}
          hint="Sum of outgoing transactions"
        />
        <KpiCard
          label="Net"
          value={formatMoney(summaryNet)}
          tone={summaryNet >= 0 ? 'positive' : 'negative'}
          loading={loadingSummary}
          hint={summaryNet >= 0 ? 'Positive balance' : 'Negative balance'}
        />
        <KpiCard
          label="Savings rate"
          value={
            savingsRate == null
              ? '—'
              : `${savingsRate.toFixed(1)}%`
          }
          tone={
            savingsRate == null
              ? 'default'
              : savingsRate >= 0
                ? 'accent'
                : 'negative'
          }
          loading={loadingSummary}
          hint={
            savingsRate == null
              ? 'No income in range'
              : 'Net ÷ Income'
          }
        />
      </section>

      {/* Charts row */}
      <section style={styles.gridTwoThirds}>
        <Panel
          title="Monthly performance"
          subtitle="Income vs expense, cumulative net line for the year"
          action={
            <div style={styles.yearLabel}>
              <span>Year</span>
              <Select
                value={String(trendYear)}
                onChange={(v) => setTrendYear(Number.parseInt(v, 10))}
                options={yearOptions}
                minWidth={100}
                ariaLabel="Trend year"
              />
            </div>
          }
        >
          {loadingMonthly ? (
            <Empty label="Loading…" />
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={monthlyData}
                  margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
                  barGap={2}
                  barCategoryGap={18}
                >
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="var(--wm-border-soft)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={axisTick}
                    axisLine={{ stroke: 'var(--wm-border)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={axisTick}
                    tickFormatter={formatCompact}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }}
                  />
                  <Bar
                    dataKey="income"
                    name="Income"
                    fill="var(--wm-positive)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="expense"
                    name="Expense"
                    fill="var(--wm-negative)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="var(--wm-accent)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: 'var(--wm-accent)' }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <LegendRow>
            <LegendSwatch color="var(--wm-positive)" label="Income" />
            <LegendSwatch color="var(--wm-negative)" label="Expense" />
            <LegendSwatch color="var(--wm-accent)" label="Net" shape="line" />
          </LegendRow>
        </Panel>

        <Panel
          title="Where the money goes"
          subtitle={`Top ${donutData.length} expense categories in range`}
        >
          {loadingByCat ? (
            <Empty label="Loading…" />
          ) : donutData.length === 0 ? (
            <Empty label="No expense data in this range." />
          ) : (
            <div style={styles.donutLayout}>
              <div style={{ flex: '1 1 220px', minHeight: 240 }}>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      innerRadius={56}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="var(--wm-bg)"
                      strokeWidth={2}
                    >
                      {donutData.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={DONUT_COLORS[idx % DONUT_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul style={styles.donutLegend}>
                {donutData.map((d, idx) => {
                  const total = donutData.reduce((s, x) => s + x.value, 0)
                  const pct = total > 0 ? (d.value / total) * 100 : 0
                  return (
                    <li key={d.name} style={styles.donutLegendItem}>
                      <span
                        style={{
                          ...styles.donutDot,
                          background:
                            DONUT_COLORS[idx % DONUT_COLORS.length],
                        }}
                      />
                      <span style={styles.donutLegendName} title={d.name}>
                        {d.name}
                      </span>
                      <span className="wm-num" style={styles.donutLegendValue}>
                        {formatMoney(d.value)}{' '}
                        <span style={styles.donutLegendPct}>
                          {pct.toFixed(1)}%
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Panel>
      </section>

      {/* Recent + Top categories + Cumulative */}
      <section style={styles.gridHalves}>
        <Panel
          title="Recent activity"
          subtitle="Six latest transactions in range"
          action={
            <button
              type="button"
              className="wm-btn wm-btn--subtle"
              onClick={() => openQuickAdd('transaction')}
            >
              + New
            </button>
          }
        >
          {loadingRecent ? (
            <Empty label="Loading…" />
          ) : !recentList || recentList.items.length === 0 ? (
            <Empty
              label="No transactions in this range yet."
              action={
                <button
                  type="button"
                  className="wm-btn wm-btn--primary"
                  onClick={() => openQuickAdd('transaction')}
                >
                  Add your first
                </button>
              }
            />
          ) : (
            <ul style={styles.txList}>
              {recentList.items.map((t) => (
                <TxRow key={t.id} tx={t} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Top spending"
          subtitle="Highest expense categories in range"
        >
          {loadingByCat ? (
            <Empty label="Loading…" />
          ) : topCategories.length === 0 ? (
            <Empty label="No expense categories to show." />
          ) : (
            <ul style={styles.topList}>
              {topCategories.map((cat, idx) => (
                <TopCategoryRow
                  key={`${cat.categoryId ?? 'none'}-${idx}`}
                  row={cat}
                  color={DONUT_COLORS[idx % DONUT_COLORS.length]}
                  max={topCategoriesMax}
                />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <Panel
          title="Cumulative net"
          subtitle={`Running balance through ${trendYear}`}
        >
          {loadingMonthly ? (
            <Empty label="Loading…" />
          ) : (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cumulativeYear}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="cumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--wm-accent)"
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--wm-accent)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="var(--wm-border-soft)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={axisTick}
                    axisLine={{ stroke: 'var(--wm-border)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={axisTick}
                    tickFormatter={formatCompact}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative"
                    stroke="var(--wm-accent)"
                    strokeWidth={2}
                    fill="url(#cumGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub components                                                      */
/* ------------------------------------------------------------------ */

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="wm-surface" style={styles.panel}>
      <header style={styles.panelHeader}>
        <div style={{ minWidth: 0 }}>
          <h2 style={styles.panelTitle}>{title}</h2>
          {subtitle ? <p style={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div>{children}</div>
    </section>
  )
}

function Empty({
  label,
  action,
}: {
  label: string
  action?: React.ReactNode
}): JSX.Element {
  return (
    <div style={styles.empty}>
      <span style={{ color: 'var(--wm-text-muted)' }}>{label}</span>
      {action}
    </div>
  )
}

type ChartTooltipProps = {
  active?: boolean
  payload?: Array<{
    name?: string
    value?: number
    color?: string
    fill?: string
  }>
  label?: string | number
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={styles.tooltip}>
      {label != null && <div style={styles.tooltipLabel}>{label}</div>}
      {payload.map((p, idx) => (
        <div key={idx} style={styles.tooltipRow}>
          <span
            style={{
              ...styles.tooltipDot,
              background: p.color ?? p.fill ?? 'var(--wm-accent)',
            }}
          />
          <span style={styles.tooltipName}>{p.name}</span>
          <span className="wm-num" style={styles.tooltipValue}>
            {typeof p.value === 'number' ? formatMoney(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function LegendRow({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  return (
    <div style={styles.legendRow} role="list">
      {children}
    </div>
  )
}

function LegendSwatch({
  color,
  label,
  shape = 'dot',
}: {
  color: string
  label: string
  shape?: 'dot' | 'line'
}): JSX.Element {
  return (
    <span style={styles.legendItem} role="listitem">
      <span
        style={{
          background: shape === 'dot' ? color : undefined,
          border: shape === 'line' ? `2px solid ${color}` : undefined,
          width: shape === 'dot' ? 10 : 14,
          height: shape === 'dot' ? 10 : 0,
          borderRadius: shape === 'dot' ? 3 : 0,
          display: 'inline-block',
        }}
      />
      <span>{label}</span>
    </span>
  )
}

function TxRow({ tx }: { tx: Transaction }): JSX.Element {
  const isIncome = tx.kind === 'INCOME'
  return (
    <li style={styles.txRow}>
      <div
        style={{
          ...styles.txIcon,
          color: isIncome ? 'var(--wm-positive)' : 'var(--wm-negative)',
          background: isIncome
            ? 'var(--wm-positive-soft)'
            : 'var(--wm-negative-soft)',
        }}
        aria-hidden
      >
        {isIncome ? '↑' : '↓'}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={styles.txDesc}>{tx.description || 'Untitled'}</div>
        <div style={styles.txMeta}>
          {formatShortDate(tx.occurredAt)} ·{' '}
          {tx.kind === 'INCOME' ? 'Income' : 'Expense'}
        </div>
      </div>
      <span
        className="wm-num"
        style={{
          ...styles.txAmount,
          color: isIncome ? 'var(--wm-positive)' : 'var(--wm-text)',
        }}
      >
        {isIncome ? '+' : '−'} {formatMoney(tx.amount)}
      </span>
    </li>
  )
}

function TopCategoryRow({
  row,
  max,
  color,
}: {
  row: CategoryReportRow
  max: number
  color: string
}): JSX.Element {
  const value = Number.parseFloat(row.total)
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <li style={styles.topRow}>
      <div style={styles.topRowHead}>
        <span
          style={{ ...styles.topRowDot, background: color }}
          aria-hidden
        />
        <span style={styles.topRowName} title={row.name}>
          {row.name}
        </span>
        <span className="wm-num" style={styles.topRowValue}>
          {formatMoney(row.total)}
        </span>
      </div>
      <div style={styles.topRowBar} aria-hidden>
        <span
          style={{
            ...styles.topRowBarFill,
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* KPI card (inline, small variant)                                    */
/* ------------------------------------------------------------------ */

function KpiCard({
  label,
  value,
  tone = 'default',
  hint,
  loading,
}: {
  label: string
  value: string
  tone?: 'default' | 'positive' | 'negative' | 'accent'
  hint?: string
  loading?: boolean
}): JSX.Element {
  const color =
    tone === 'positive'
      ? 'var(--wm-positive)'
      : tone === 'negative'
        ? 'var(--wm-negative)'
        : tone === 'accent'
          ? 'var(--wm-accent)'
          : 'var(--wm-text)'
  return (
    <div className="wm-surface" style={styles.kpi}>
      <span className="wm-label">{label}</span>
      <span className="wm-num" style={{ ...styles.kpiValue, color }}>
        {loading ? '—' : value}
      </span>
      {hint ? <span style={styles.kpiHint}>{hint}</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const axisTick = { fill: 'var(--wm-text-muted)', fontSize: 11 }

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    maxWidth: 1400,
    margin: '0 auto',
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  pageEyebrow: {
    fontSize: 'var(--wm-fs-xs)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--wm-text-muted)',
    marginBottom: 6,
  },
  h1: {
    fontSize: 'var(--wm-fs-2xl)',
    letterSpacing: '-0.02em',
    margin: 0,
    fontWeight: 600,
  },
  sub: {
    color: 'var(--wm-text-muted)',
    fontSize: 'var(--wm-fs-sm)',
    marginTop: 4,
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 10,
  },
  chipsRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  rangeInputs: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dash: {
    color: 'var(--wm-text-soft)',
    fontSize: 'var(--wm-fs-sm)',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 14,
  },
  kpi: {
    padding: '16px 18px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  kpiValue: {
    fontSize: '1.6rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  kpiHint: {
    color: 'var(--wm-text-muted)',
    fontSize: 'var(--wm-fs-xs)',
  },
  gridTwoThirds: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gap: 14,
  },
  gridHalves: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 14,
  },
  panel: {
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minHeight: 0,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  panelTitle: {
    fontSize: 'var(--wm-fs-lg)',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  panelSubtitle: {
    fontSize: 'var(--wm-fs-xs)',
    color: 'var(--wm-text-muted)',
    marginTop: 2,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 12,
    padding: '24px 4px',
    color: 'var(--wm-text-muted)',
  },
  legendRow: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--wm-fs-xs)',
    color: 'var(--wm-text-muted)',
  },
  yearLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--wm-fs-xs)',
    color: 'var(--wm-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tooltip: {
    background: 'var(--wm-surface-2)',
    border: '1px solid var(--wm-border)',
    borderRadius: 'var(--wm-radius-md)',
    padding: '10px 12px',
    boxShadow: 'var(--wm-shadow-soft)',
    minWidth: 160,
    color: 'var(--wm-text)',
  },
  tooltipLabel: {
    fontSize: 'var(--wm-fs-xs)',
    color: 'var(--wm-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  tooltipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--wm-fs-sm)',
    padding: '2px 0',
  },
  tooltipDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    display: 'inline-block',
  },
  tooltipName: {
    color: 'var(--wm-text-muted)',
    flex: 1,
  },
  tooltipValue: {
    color: 'var(--wm-text)',
    fontWeight: 600,
  },
  donutLayout: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  donutLegend: {
    flex: '1 1 200px',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  donutLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '4px 0',
    fontSize: 'var(--wm-fs-sm)',
    borderBottom: '1px dashed var(--wm-border-soft)',
  },
  donutDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
    display: 'inline-block',
  },
  donutLegendName: {
    flex: 1,
    color: 'var(--wm-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  donutLegendValue: {
    color: 'var(--wm-text)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  donutLegendPct: {
    color: 'var(--wm-text-muted)',
    fontSize: 'var(--wm-fs-xs)',
  },
  txList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  txRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid var(--wm-border-soft)',
  },
  txIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  txDesc: {
    color: 'var(--wm-text)',
    fontSize: 'var(--wm-fs-md)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  txMeta: {
    color: 'var(--wm-text-muted)',
    fontSize: 'var(--wm-fs-xs)',
    marginTop: 1,
  },
  txAmount: {
    fontSize: 'var(--wm-fs-md)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  topList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  topRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  topRowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--wm-fs-sm)',
  },
  topRowDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  },
  topRowName: {
    flex: 1,
    color: 'var(--wm-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  topRowValue: {
    color: 'var(--wm-text-muted)',
  },
  topRowBar: {
    position: 'relative',
    height: 5,
    width: '100%',
    background: 'var(--wm-surface-3)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  topRowBarFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 999,
    transition: 'width 240ms ease',
  },
}
