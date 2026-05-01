import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type {
  Category,
  PaginatedResponse,
  Source,
  Transaction,
  TransactionKind,
} from '@wimm/shared'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { PickerModal, type PickerOption } from '../components/ui/picker-modal'
import { DateRangeModal } from '../components/transactions/date-range-modal'
import { TransactionCard } from '../components/transactions/transaction-card'
import { Screen } from '../components/screen'
import { useQuickAdd } from '../context/quick-add-context'
import { apiClient } from '../lib/api-client'
import { categoryDisplayName } from '../lib/category-label'
import { computeRange, type DateRange, type RangePreset } from '../lib/dates'
import { colors, fontSize, radius, spacing, tracking } from '../theme/tokens'

type KindFilter = 'ALL' | TransactionKind
type PeriodId = RangePreset | 'custom'

const PERIOD_PRESETS: { id: RangePreset; labelKey: string }[] = [
  { id: 'last30', labelKey: 'dashboard.range.last30' },
  { id: 'mtd', labelKey: 'dashboard.range.mtd' },
  { id: 'ytd', labelKey: 'dashboard.range.ytd' },
]

const KIND_OPTIONS: { value: KindFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'transactions.kindAll' },
  { value: 'INCOME', labelKey: 'transactions.kindIncome' },
  { value: 'EXPENSE', labelKey: 'transactions.kindExpense' },
]

const PAGE_SIZE = 30

export function TransactionsScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { open: openQuickAdd } = useQuickAdd()
  const [period, setPeriod] = useState<PeriodId>('last30')
  const [customRange, setCustomRange] = useState<DateRange | null>(null)
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [categoryId, setCategoryId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [showDateRangeModal, setShowDateRangeModal] = useState(false)

  const range = useMemo<DateRange>(() => {
    if (period === 'custom' && customRange) return customRange
    return computeRange(period === 'custom' ? 'last30' : period)
  }, [period, customRange])

  const baseFilters = useMemo(() => {
    const params: Record<string, string> = {
      from: range.from,
      to: range.to,
      includeProjected: 'false',
    }
    if (categoryId) params.categoryId = categoryId
    if (sourceId) params.sourceId = sourceId
    if (kind !== 'ALL') params.kind = kind
    return params
  }, [range, categoryId, sourceId, kind])

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['transactions', baseFilters],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await apiClient.get<PaginatedResponse<Transaction>>(
        '/transactions',
        {
          params: { ...baseFilters, page: pageParam, pageSize: PAGE_SIZE },
        },
      )
      return data
    },
    getNextPageParam: (lastPage, allPages) => {
      const totalPages = Math.max(
        1,
        Math.ceil(lastPage.total / lastPage.pageSize),
      )
      return allPages.length < totalPages ? allPages.length + 1 : undefined
    },
  })

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const sourceById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sources) m.set(s.id, s.name)
    return m
  }, [sources])
  const categoryById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, categoryDisplayName(c, t))
    return m
  }, [categories, t])

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/transactions/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const onLongPress = useCallback(
    (tx: Transaction) => {
      Alert.alert(
        t('transactions.deleteConfirm'),
        tx.description,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => deleteMut.mutate(tx.id),
          },
        ],
      )
    },
    [deleteMut, t],
  )

  const items = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  )
  const total = data?.pages[0]?.total ?? 0

  const sourceOptions: PickerOption[] = useMemo(
    () => [
      { value: '', label: t('transactions.allSources') },
      ...sources.map((s) => ({ value: s.id, label: s.name })),
    ],
    [sources, t],
  )
  const categoryOptions: PickerOption[] = useMemo(() => {
    const sorted = categories
      .map((c) => ({ value: c.id, label: categoryDisplayName(c, t) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: '', label: t('transactions.allCategories') }, ...sorted]
  }, [categories, t])

  const selectedCategoryLabel = categoryId
    ? categoryById.get(categoryId) ?? t('transactions.allCategories')
    : t('transactions.allCategories')
  const selectedSourceLabel = sourceId
    ? sourceById.get(sourceId) ?? t('transactions.allSources')
    : t('transactions.allSources')

  return (
    <Screen>
      <PageHeader
        eyebrow={t('transactions.eyebrow')}
        title={t('nav.transactions')}
        subtitle={t('transactions.recordsInRange', {
          count: total,
          from: range.from,
          to: range.to,
        })}
      />

      <View style={styles.filters}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {PERIOD_PRESETS.map((p) => (
            <FilterChip
              key={p.id}
              label={t(p.labelKey)}
              active={period === p.id}
              onPress={() => setPeriod(p.id)}
            />
          ))}
          <FilterChip
            label={t('common.custom')}
            active={period === 'custom'}
            onPress={() => setShowDateRangeModal(true)}
          />
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {KIND_OPTIONS.map((k) => (
            <FilterChip
              key={k.value}
              label={t(k.labelKey)}
              active={kind === k.value}
              onPress={() => setKind(k.value)}
            />
          ))}
        </ScrollView>

        <View style={styles.chipRow}>
          <FilterChip
            label={`${t('transactions.category')}: ${selectedCategoryLabel}`}
            active={categoryId !== ''}
            onPress={() => setShowCategoryPicker(true)}
          />
          <FilterChip
            label={`${t('transactions.source')}: ${selectedSourceLabel}`}
            active={sourceId !== ''}
            onPress={() => setShowSourcePicker(true)}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('transactions.noMatch')}
          subtitle={t('transactions.recordsInRange', {
            count: 0,
            from: range.from,
            to: range.to,
          })}
          action={
            <Button
              label={t('transactions.newTransaction')}
              variant="primary"
              onPress={() => openQuickAdd('transaction')}
            />
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(tx) => tx.id}
          renderItem={({ item }) => (
            <TransactionCard
              transaction={item}
              categoryName={
                item.categoryId ? categoryById.get(item.categoryId) : undefined
              }
              sourceName={
                item.sourceId ? sourceById.get(item.sourceId) : undefined
              }
              onLongPress={() => onLongPress(item)}
            />
          )}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isFetchingNextPage}
              onRefresh={() => void refetch()}
              tintColor={colors.fgMuted}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.fgMuted} />
              </View>
            ) : null
          }
        />
      )}

      <PickerModal
        visible={showCategoryPicker}
        onClose={() => setShowCategoryPicker(false)}
        title={t('transactions.category')}
        options={categoryOptions}
        selected={categoryId}
        onSelect={setCategoryId}
      />
      <PickerModal
        visible={showSourcePicker}
        onClose={() => setShowSourcePicker(false)}
        title={t('transactions.source')}
        options={sourceOptions}
        selected={sourceId}
        onSelect={setSourceId}
      />
      <DateRangeModal
        visible={showDateRangeModal}
        onClose={() => setShowDateRangeModal(false)}
        initial={range}
        onApply={(r) => {
          setCustomRange(r)
          setPeriod('custom')
        }}
      />
    </Screen>
  )
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text
        style={[styles.chipLabel, active && styles.chipLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function Separator(): JSX.Element {
  return <View style={styles.separator} />
}

const styles = StyleSheet.create({
  filters: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: spacing.lg,
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  separator: {
    height: spacing.sm,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
})
