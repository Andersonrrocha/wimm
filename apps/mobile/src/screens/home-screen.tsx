import { useQuery } from '@tanstack/react-query'
import { ChartColumn, ChartPie } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type {
  ReportByCategoryResponse,
  ReportFutureCommitmentsResponse,
  ReportMonthlyResponse,
  ReportSummaryResponse,
} from '@wimm/shared'
import { CategoryBarRow } from '../components/dashboard/category-bar-row'
import {
  CategoryDonut,
  type CategorySlice,
} from '../components/dashboard/category-donut'
import { MonthlyTrendChart } from '../components/dashboard/monthly-trend-chart'
import { EmptyState } from '../components/ui/empty-state'
import { KpiCard } from '../components/ui/kpi-card'
import { PageHeader } from '../components/ui/page-header'
import { Panel } from '../components/ui/panel'
import { Screen } from '../components/screen'
import { useAuth } from '../context/auth-context'
import { apiClient } from '../lib/api-client'
import { computeRange, type RangePreset } from '../lib/dates'
import { formatMoney } from '../lib/format-money'
import { usePersistedPreference } from '../lib/use-persisted-preference'
import { colors, fontSize, radius, spacing, tracking } from '../theme/tokens'

type ExpenseView = 'donut' | 'bars'

const CATEGORY_BAR_COLORS = [
  colors.chart1,
  colors.chart2,
  colors.chart4,
  colors.chart5,
  colors.chart6,
  colors.chart3,
]

const RANGE_PRESETS: { id: RangePreset; labelKey: string }[] = [
  { id: 'mtd', labelKey: 'dashboard.range.mtd' },
  { id: 'last30', labelKey: 'dashboard.range.last30' },
  { id: 'ytd', labelKey: 'dashboard.range.ytd' },
]

const TOP_CATEGORY_LIMIT = 5

function nextMonth(now: Date = new Date()): { year: number; month: number } {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
}

export function HomeScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null

  const [range, setRange] = useState<RangePreset>('mtd')
  const [expenseView, setExpenseView] = usePersistedPreference<ExpenseView>(
    'home.expenseView',
    'donut',
  )
  const dateRange = useMemo(() => computeRange(range), [range])
  const forecast = useMemo(() => nextMonth(), [])

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['reports', 'summary', dateRange],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportSummaryResponse>(
        '/reports/summary',
        { params: dateRange },
      )
      return data
    },
  })

  const { data: byCategory, isLoading: loadingByCat } = useQuery({
    queryKey: ['reports', 'by-category', dateRange],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportByCategoryResponse>(
        '/reports/by-category',
        { params: dateRange },
      )
      return data
    },
  })

  const { data: commitments, isLoading: loadingCommitments } = useQuery({
    queryKey: ['reports', 'future-commitments', forecast],
    queryFn: async () => {
      const { data } = await apiClient.get<ReportFutureCommitmentsResponse>(
        '/reports/future-commitments',
        { params: forecast },
      )
      return data
    },
  })

  const trendYear = useMemo(() => new Date().getFullYear(), [])
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

  const incomeNum = parseAmount(summary?.income)
  const netNum = parseAmount(summary?.net)
  const savingsRate =
    incomeNum > 0 ? Math.round((netNum / incomeNum) * 100) : null

  const expenseSlices = useMemo<{
    slices: CategorySlice[]
    total: number
  }>(() => {
    const items = (byCategory?.items ?? []).filter(
      (r) => r.kind === 'EXPENSE',
    )
    const sorted = items
      .map((r) => ({
        id: r.categoryId ?? `unknown-${r.name}`,
        label: r.name,
        value: parseAmount(r.total),
      }))
      .sort((a, b) => b.value - a.value)

    const top = sorted.slice(0, TOP_CATEGORY_LIMIT)
    const otherTotal = sorted
      .slice(TOP_CATEGORY_LIMIT)
      .reduce((sum, s) => sum + s.value, 0)

    const slices: CategorySlice[] = [...top]
    if (otherTotal > 0) {
      slices.push({
        id: '__other__',
        label: 'Outros',
        value: otherTotal,
      })
    }
    const total = sorted.reduce((sum, s) => sum + s.value, 0)
    return { slices, total }
  }, [byCategory])

  return (
    <Screen scroll>
      <PageHeader
        eyebrow={t('dashboard.overview')}
        title={
          user
            ? t('dashboard.welcomeWithName', { name: user.username })
            : t('dashboard.welcomeBack')
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {RANGE_PRESETS.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setRange(p.id)}
            style={({ pressed }) => [
              styles.chip,
              range === p.id && styles.chipActive,
              pressed && styles.chipPressed,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                range === p.id && styles.chipLabelActive,
              ]}
            >
              {t(p.labelKey)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.kpiStack}>
        <KpiCard
          label={t('dashboard.kpi.income')}
          value={loadingSummary ? '—' : formatMoney(summary?.income ?? '0')}
          tone="positive"
          sign="+"
        />
        <KpiCard
          label={t('dashboard.kpi.expense')}
          value={loadingSummary ? '—' : formatMoney(summary?.expense ?? '0')}
          tone="negative"
          sign="−"
        />
        <KpiCard
          label={t('dashboard.kpi.net')}
          value={loadingSummary ? '—' : formatMoney(summary?.net ?? '0')}
          tone={netNum >= 0 ? 'positive' : 'negative'}
          hint={
            savingsRate !== null
              ? `${t('dashboard.kpi.savingsRate')}: ${savingsRate}%`
              : t('dashboard.kpi.savingsNoIncome')
          }
        />
      </View>

      <SectionHeader
        title={t('dashboard.whereMoneyGoes')}
        subtitle={t('dashboard.whereMoneyGoesSub', {
          count: TOP_CATEGORY_LIMIT,
        })}
      />
      <Panel>
        {loadingByCat ? (
          <Loader />
        ) : expenseSlices.slices.length === 0 ? (
          <Text style={styles.muted}>
            {t('dashboard.noExpenseCategories')}
          </Text>
        ) : (
          <>
            <View style={styles.viewToggleRow}>
              <ViewToggle value={expenseView} onChange={setExpenseView} />
            </View>
            {expenseView === 'donut' ? (
              <CategoryDonut
                slices={expenseSlices.slices}
                centerValue={formatMoney(expenseSlices.total)}
                centerLabel={t('dashboard.kpi.expense')}
              />
            ) : (
              <View style={styles.barsList}>
                {expenseSlices.slices.map((s, i) => (
                  <CategoryBarRow
                    key={s.id}
                    label={s.label}
                    value={formatMoney(s.value)}
                    fraction={
                      expenseSlices.slices[0].value > 0
                        ? s.value / expenseSlices.slices[0].value
                        : 0
                    }
                    color={
                      CATEGORY_BAR_COLORS[i % CATEGORY_BAR_COLORS.length]
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
      </Panel>

      <SectionHeader
        title={t('dashboard.monthlyPerformance')}
        subtitle={t('dashboard.cumulativeNetSub', { year: trendYear })}
      />
      <Panel>
        {loadingMonthly || !monthly ? (
          <Loader />
        ) : (
          <MonthlyTrendChart months={monthly.months} />
        )}
      </Panel>

      <SectionHeader
        title={t('dashboard.commitments.title')}
        subtitle={t('dashboard.commitments.subtitle')}
      />
      <Panel>
        {loadingCommitments || !commitments ? (
          <Loader />
        ) : (
          <CommitmentsBlock data={commitments} />
        )}
      </Panel>
    </Screen>
  )
}

function CommitmentsBlock({
  data,
}: {
  data: ReportFutureCommitmentsResponse
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <View style={styles.commitments}>
      <View style={styles.commitTotals}>
        <CommitTotal
          label={t('dashboard.commitments.recurringExpense')}
          value={formatMoney(data.recurringExpenseTotal)}
        />
        <CommitTotal
          label={t('dashboard.commitments.cardInstallments')}
          value={formatMoney(data.cardInstallmentsTotal)}
        />
        <CommitTotal
          label={t('dashboard.commitments.totalExpense')}
          value={formatMoney(data.totalCommittedExpense)}
          accent
        />
      </View>

      {data.cardBySource.length > 0 ? (
        <>
          <Text style={styles.subSectionLabel}>
            {t('dashboard.commitments.byCard')}
          </Text>
          <View style={styles.cardList}>
            {data.cardBySource.map((c) => (
              <View key={c.sourceId} style={styles.cardRow}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {c.sourceName}
                </Text>
                <Text style={styles.cardValue}>{formatMoney(c.total)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  )
}

function CommitTotal({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}): JSX.Element {
  return (
    <View style={styles.commitTotalRow}>
      <Text style={styles.commitLabel}>{label}</Text>
      <Text style={[styles.commitValue, accent && styles.commitValueAccent]}>
        {value}
      </Text>
    </View>
  )
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}): JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  )
}

function Loader(): JSX.Element {
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={colors.fgMuted} />
    </View>
  )
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ExpenseView
  onChange: (v: ExpenseView) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <View style={styles.viewToggle}>
      <ViewToggleButton
        active={value === 'donut'}
        label={t('dashboard.viewDonut')}
        onPress={() => onChange('donut')}
      >
        <ChartPie
          size={16}
          color={value === 'donut' ? colors.fg : colors.fgMuted}
        />
      </ViewToggleButton>
      <ViewToggleButton
        active={value === 'bars'}
        label={t('dashboard.viewBars')}
        onPress={() => onChange('bars')}
      >
        <ChartColumn
          size={16}
          color={value === 'bars' ? colors.fg : colors.fgMuted}
        />
      </ViewToggleButton>
    </View>
  )
}

function ViewToggleButton({
  active,
  label,
  onPress,
  children,
}: {
  active: boolean
  label: string
  onPress: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      style={[styles.viewToggleBtn, active && styles.viewToggleBtnActive]}
    >
      {children}
    </Pressable>
  )
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0
  const n = Number.parseFloat(value)
  return Number.isNaN(n) ? 0 : n
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: spacing.lg,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface1,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: tracking.base,
  },
  chipLabelActive: {
    color: colors.accent,
  },
  kpiStack: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: 2,
  },
  sectionTitle: {
    color: colors.fg,
    fontSize: fontSize.lg,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  sectionSub: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  muted: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  viewToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.sm,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderColor: colors.lineSoft,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 3,
    gap: 2,
  },
  viewToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.xs,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.surface3,
  },
  barsList: {
    gap: spacing.md,
  },
  loader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  commitments: {
    gap: spacing.md,
  },
  commitTotals: {
    gap: spacing.sm,
  },
  commitTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  commitLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  commitValue: {
    color: colors.fg,
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  commitValueAccent: {
    color: colors.accent,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  subSectionLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
    marginTop: spacing.sm,
  },
  cardList: {
    gap: 6,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 4,
    gap: spacing.md,
  },
  cardName: {
    color: colors.fg,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  cardValue: {
    color: colors.fg,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
})
