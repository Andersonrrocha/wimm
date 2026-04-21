import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  CategoryReportRow,
  ReportByCategoryResponse,
  ReportMonthlyResponse,
  ReportSummaryResponse,
} from '@wimm/shared'
import { useAuth } from '../context/auth-context'
import { apiClient } from '../lib/api-client'

function currentMonthRange(): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const lastDay = new Date(y, m + 1, 0).getDate()
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
  }
}

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const EXPENSE_BAR = '#e57373'
const INCOME_BAR = '#81c784'

export function DashboardPage(): JSX.Element {
  const { state } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const [range, setRange] = useState(() => currentMonthRange())
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

  const expenseChartData = useMemo(() => {
    const items = (byCategory?.items ?? []).filter(
      (r: CategoryReportRow) => r.kind === 'EXPENSE',
    )
    return items.slice(0, 12).map((r) => ({
      name:
        r.name.length > 18 ? `${r.name.slice(0, 16)}…` : r.name,
      fullName: r.name,
      value: Number.parseFloat(r.total),
    }))
  }, [byCategory])

  const incomeChartData = useMemo(() => {
    const items = (byCategory?.items ?? []).filter(
      (r: CategoryReportRow) => r.kind === 'INCOME',
    )
    return items.slice(0, 12).map((r) => ({
      name:
        r.name.length > 18 ? `${r.name.slice(0, 16)}…` : r.name,
      fullName: r.name,
      value: Number.parseFloat(r.total),
    }))
  }, [byCategory])

  const monthlyTrendData = useMemo(() => {
    return (monthly?.months ?? []).map((m) => ({
      label: m.label,
      income: Number.parseFloat(m.income),
      expense: Number.parseFloat(m.expense),
      net: Number.parseFloat(m.net),
    }))
  }, [monthly])

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Dashboard</h1>
      <p style={styles.sub}>
        Welcome{user ? `, ${user.email}` : ''}. Summary for the selected period.
      </p>

      <div style={styles.rangeRow}>
        <label style={styles.label}>
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) =>
              setRange((r) => ({ ...r, from: e.target.value }))
            }
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            style={styles.input}
          />
        </label>
        <button
          type="button"
          onClick={() => setRange(currentMonthRange())}
          style={styles.btnGhost}
        >
          This month
        </button>
      </div>

      <section style={styles.trendSection}>
        <div style={styles.trendHeader}>
          <h2 style={styles.h2}>Monthly trend</h2>
          <label style={styles.label}>
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={trendYear}
              onChange={(e) => {
                const y = Number.parseInt(e.target.value, 10)
                if (!Number.isNaN(y)) setTrendYear(y)
              }}
              style={{ ...styles.input, width: 88 }}
            />
          </label>
        </div>
        {loadingMonthly ? (
          <p style={styles.muted}>Loading…</p>
        ) : (
          <div style={styles.chartBox}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={monthlyTrendData}
                margin={{ top: 8, right: 8, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: '#1e1e1e',
                    border: '1px solid #333',
                    borderRadius: 8,
                  }}
                  formatter={(value: number) => formatMoney(String(value))}
                />
                <Legend />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill={INCOME_BAR}
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="expense"
                  name="Expense"
                  fill={EXPENSE_BAR}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            <div style={styles.netChartWrap}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={monthlyTrendData}
                  margin={{ top: 8, right: 8, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#1e1e1e',
                      border: '1px solid #333',
                      borderRadius: 8,
                    }}
                    formatter={(value: number) => formatMoney(String(value))}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="#90caf9"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Income</div>
          <div style={{ ...styles.cardValue, color: INCOME_BAR }}>
            {loadingSummary
              ? '…'
              : formatMoney(summary?.income ?? '0')}
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Expense</div>
          <div style={{ ...styles.cardValue, color: EXPENSE_BAR }}>
            {loadingSummary
              ? '…'
              : formatMoney(summary?.expense ?? '0')}
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Net</div>
          <div
            style={{
              ...styles.cardValue,
              color:
                Number.parseFloat(summary?.net ?? '0') >= 0
                  ? '#a5d6a7'
                  : '#ffab91',
            }}
          >
            {loadingSummary ? '…' : formatMoney(summary?.net ?? '0')}
          </div>
        </div>
      </div>

      <div style={styles.charts}>
        <section style={styles.chartSection}>
          <h2 style={styles.h2}>Expenses by category</h2>
          {loadingByCat ? (
            <p style={styles.muted}>Loading…</p>
          ) : expenseChartData.length === 0 ? (
            <p style={styles.muted}>No expense data in this range.</p>
          ) : (
            <div style={styles.chartBox}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={expenseChartData}
                  margin={{ top: 8, right: 8, left: 4, bottom: 48 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#888', fontSize: 11 }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#1e1e1e',
                      border: '1px solid #333',
                      borderRadius: 8,
                    }}
                    formatter={(value: number) => [
                      formatMoney(String(value)),
                      'Total',
                    ]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ?? ''
                    }
                  />
                  <Bar
                    dataKey="value"
                    name="Expense"
                    fill={EXPENSE_BAR}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section style={styles.chartSection}>
          <h2 style={styles.h2}>Income by category</h2>
          {loadingByCat ? (
            <p style={styles.muted}>Loading…</p>
          ) : incomeChartData.length === 0 ? (
            <p style={styles.muted}>No income data in this range.</p>
          ) : (
            <div style={styles.chartBox}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={incomeChartData}
                  margin={{ top: 8, right: 8, left: 4, bottom: 48 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#888', fontSize: 11 }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#1e1e1e',
                      border: '1px solid #333',
                      borderRadius: 8,
                    }}
                    formatter={(value: number) => [
                      formatMoney(String(value)),
                      'Total',
                    ]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ?? ''
                    }
                  />
                  <Bar
                    dataKey="value"
                    name="Income"
                    fill={INCOME_BAR}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960 },
  h1: { fontSize: '1.35rem', marginBottom: '0.35rem' },
  sub: { color: '#888', fontSize: '0.9rem', marginBottom: '1rem' },
  rangeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    alignItems: 'flex-end',
    marginBottom: '1.25rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8rem',
    color: '#aaa',
  },
  input: {
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#ececec',
  },
  btnGhost: {
    padding: '0.45rem 0.85rem',
    borderRadius: 6,
    border: '1px solid #444',
    background: 'transparent',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: '0.85rem',
    marginBottom: 2,
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  card: {
    background: '#161616',
    border: '1px solid #252525',
    borderRadius: 10,
    padding: '1rem',
  },
  cardLabel: { fontSize: '0.75rem', color: '#888', marginBottom: '0.35rem' },
  cardValue: { fontSize: '1.35rem', fontWeight: 600 },
  charts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  trendSection: { marginBottom: '1.5rem' },
  trendHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '0.75rem',
  },
  netChartWrap: { marginTop: '1rem' },
  chartSection: {},
  h2: { fontSize: '1rem', marginBottom: '0.75rem', color: '#ccc' },
  chartBox: { width: '100%', minHeight: 280 },
  muted: { color: '#666', fontSize: '0.9rem' },
}
