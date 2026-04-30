import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { Plus } from 'lucide-react'
import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type {
  Category,
  PaginatedResponse,
  Source,
  Transaction,
  TransactionKind,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'
import { buildCategoryOptionGroups } from '../lib/category-label'
import { PageHeader } from '../components/ui/page-header'
import { DatePicker } from '../components/ui/date-picker'
import { Select } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty-state'
import { Field } from '../components/ui/field'
import { Panel } from '../components/ui/panel'
import type { QuickAddTab } from '../components/quick-add-modal'
import { dateFnsLocaleForLang } from '../lib/date-fns-locale'
import { formatDateTime, formatShortDate, toIsoDate } from '../lib/dates'
import { formatTransactionDescriptionForDisplay } from '../lib/format-transaction-description'
import { cn } from '../lib/cn'

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

type KindFilter = 'ALL' | TransactionKind

/** Select value for API `uncategorizedOnly=true` (not a category UUID). */
const CATEGORY_FILTER_UNCATEGORIZED = 'uncategorized'

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function TransactionsPage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )
  const qc = useQueryClient()
  const { openQuickAdd } = useOutletContext<OutletCtx>()

  const [from, setFrom] = useState(() => toIsoDate(startOfDay(subDays(new Date(), 59))))
  const [to, setTo] = useState(() => toIsoDate(endOfDay(new Date())))
  /** `yyyy-MM` when using the month shortcut; empty when using custom from/to. */
  const [monthShortcut, setMonthShortcut] = useState('')
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [categoryId, setCategoryId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [showProjectedInstallments, setShowProjectedInstallments] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 20

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

  const queryParams = useMemo(() => {
    const params: Record<string, string | number> = {
      page,
      pageSize,
      /** Axios omits boolean `false` from query strings; use explicit strings. */
      includeProjected: showProjectedInstallments ? 'true' : 'false',
    }
    if (from) params.from = from
    if (to) params.to = to
    if (categoryId === CATEGORY_FILTER_UNCATEGORIZED) {
      params.uncategorizedOnly = 'true'
    } else if (categoryId) {
      params.categoryId = categoryId
    }
    if (sourceId) params.sourceId = sourceId
    return params
  }, [page, from, to, categoryId, sourceId, showProjectedInstallments])

  const { data: list, isLoading, error } = useQuery({
    queryKey: ['transactions', queryParams],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<Transaction>>(
        '/transactions',
        { params: queryParams },
      )
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/transactions/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const [categoryUpdatingId, setCategoryUpdatingId] = useState<string | null>(null)
  const updateCategoryMut = useMutation({
    mutationFn: async (vars: { id: string; categoryId: string | null }) => {
      await apiClient.patch(`/transactions/${vars.id}`, {
        categoryId: vars.categoryId,
      })
    },
    onMutate: (vars) => {
      setCategoryUpdatingId(vars.id)
    },
    onSettled: async () => {
      setCategoryUpdatingId(null)
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const onRowCategoryChange = useCallback(
    (id: string, value: string) => {
      const categoryId = value === '' ? null : value
      updateCategoryMut.mutate({ id, categoryId })
    },
    [updateCategoryMut],
  )

  const items = list?.items ?? []
  const filtered = useMemo(() => {
    if (kind === 'ALL') return items
    return items.filter((t) => t.kind === kind)
  }, [items, kind])

  const sourceNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sources) m.set(s.id, s.name)
    return m
  }, [sources])

  const totalPages = useMemo(() => {
    if (!list) return 1
    return Math.max(1, Math.ceil(list.total / list.pageSize))
  }, [list])

  const resetPage = (): void => setPage(1)

  const monthShortcutOptions = useMemo(() => {
    const now = new Date()
    const opts: { value: string; label: string }[] = [
      { value: '', label: t('transactions.monthFilterCustom') },
    ]
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({
        value: key,
        label: format(d, 'LLLL yyyy', { locale: dfLocale }),
      })
    }
    return opts
  }, [dfLocale, t])

  const applyMonthShortcut = useCallback(
    (key: string) => {
      setMonthShortcut(key)
      if (!key) return
      const [yStr, mStr] = key.split('-')
      const y = Number(yStr)
      const mo = Number(mStr)
      if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return
      const first = startOfMonth(new Date(y, mo - 1, 1))
      const last = endOfMonth(first)
      setFrom(toIsoDate(startOfDay(first)))
      setTo(toIsoDate(endOfDay(last)))
      setPage(1)
    },
    [],
  )

  const { leadingOptions: filterCatLeading, optionGroups: filterCatGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        leadingLabel: t('transactions.allCategories'),
      }),
    [categories, t],
  )
  const filterCatAllLeading = useMemo(
    () => [
      ...filterCatLeading,
      { value: CATEGORY_FILTER_UNCATEGORIZED, label: t('transactions.uncategorizedFilter') },
    ],
    [filterCatLeading, t],
  )

  const sourceOptions = useMemo(
    () => [
      { value: '', label: t('transactions.allSources') },
      ...sources.map((s) => ({ value: s.id, label: s.name })),
    ],
    [sources, t],
  )

  const { leadingOptions: rowCatLeadingExpense, optionGroups: rowCatExpenseGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        filterType: 'EXPENSE',
        leadingLabel: t('transactions.uncategorized'),
      }),
    [categories, t],
  )
  const { leadingOptions: rowCatLeadingIncome, optionGroups: rowCatIncomeGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        filterType: 'INCOME',
        leadingLabel: t('transactions.uncategorized'),
      }),
    [categories, t],
  )

  const subtitle =
    list?.total !== undefined
      ? t('transactions.recordsInRange', {
          count: list.total,
          from: formatShortDate(from, dfLocale),
          to: formatShortDate(to, dfLocale),
        })
      : t('transactions.recordsLoading', {
          from: formatShortDate(from, dfLocale),
          to: formatShortDate(to, dfLocale),
        })

  return (
    <div className="mx-auto flex max-w-container flex-col gap-6">
      <PageHeader
        eyebrow={t('transactions.eyebrow')}
        title={t('transactions.title')}
        subtitle={subtitle}
        actions={
          <Button variant="primary" onClick={() => openQuickAdd('transaction')}>
            <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            {t('transactions.newTransaction')}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <Field label={t('transactions.from')}>
              <DatePicker
                value={from}
                onChange={(v) => {
                  setMonthShortcut('')
                  setFrom(v)
                  resetPage()
                }}
                minWidth={160}
              />
            </Field>
            <Field label={t('transactions.to')}>
              <DatePicker
                value={to}
                onChange={(v) => {
                  setMonthShortcut('')
                  setTo(v)
                  resetPage()
                }}
                minWidth={160}
              />
            </Field>
            <Field label={t('transactions.monthFilter')}>
              <Select
                value={monthShortcut}
                onChange={applyMonthShortcut}
                options={monthShortcutOptions}
                placeholder={t('transactions.monthFilterCustom')}
                ariaLabel={t('transactions.monthFilterAria')}
                minWidth={200}
              />
            </Field>
            <Field label={t('transactions.category')}>
              <Select
                value={categoryId}
                onChange={(v) => {
                  setCategoryId(v)
                  resetPage()
                }}
                leadingOptions={filterCatAllLeading}
                optionGroups={filterCatGroups}
                placeholder={t('transactions.allCategories')}
                minWidth={170}
                ariaLabel={t('transactions.category')}
              />
            </Field>
            <Field label={t('transactions.source')}>
              <Select
                value={sourceId}
                onChange={(v) => {
                  setSourceId(v)
                  resetPage()
                }}
                options={sourceOptions}
                placeholder={t('transactions.allSources')}
                minWidth={170}
                ariaLabel={t('transactions.source')}
              />
            </Field>
            <label className="flex max-w-[280px] cursor-pointer items-center gap-2 self-end pb-1 text-wm-sm text-fg">
              <input
                type="checkbox"
                className="wm-check"
                checked={showProjectedInstallments}
                onChange={(e) => {
                  setShowProjectedInstallments(e.target.checked)
                  resetPage()
                }}
                title={t('transactions.showProjectedInstallmentsHint')}
              />
              <span title={t('transactions.showProjectedInstallmentsHint')}>
                {t('transactions.showProjectedInstallments')}
              </span>
            </label>
          </div>

          <div
            role="group"
            aria-label={t('transactions.kindFilterAria')}
            className="flex gap-1.5"
          >
            {(['ALL', 'INCOME', 'EXPENSE'] as const).map((k) => (
              <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
                {k === 'ALL'
                  ? t('transactions.kindAll')
                  : k === 'INCOME'
                    ? t('transactions.kindIncome')
                    : t('transactions.kindExpense')}
              </Chip>
            ))}
          </div>
        </div>
      </Panel>

      <Panel flush className="overflow-hidden">
        {error ? (
          <p className="p-[18px] text-wm-sm text-negative">
            {t('transactions.failedLoad')}
          </p>
        ) : isLoading ? (
          <p className="p-[18px] text-wm-sm text-fg-muted">
            {t('common.loading')}
          </p>
        ) : filtered.length === 0 ? (
          <EmptyState className="p-6">
            <span>{t('transactions.noMatch')}</span>
            <Button variant="primary" onClick={() => openQuickAdd('transaction')}>
              {t('transactions.addTransaction')}
            </Button>
          </EmptyState>
        ) : (
          <div className="overflow-auto">
            <table className="wm-table">
              <thead>
                <tr>
                  <th>{t('transactions.when')}</th>
                  <th>{t('transactions.description')}</th>
                  <th>{t('transactions.categoryCol')}</th>
                  <th>{t('transactions.sourceCol')}</th>
                  <th className="text-right">{t('transactions.amount')}</th>
                  <th className="wm-table__actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isIncome = row.kind === 'INCOME'
                  const displayDescription = formatTransactionDescriptionForDisplay(
                    row.description,
                    row.isProjected,
                    t,
                  )
                  return (
                    <tr key={row.id}>
                      <td className="wm-muted">
                        {formatDateTime(row.occurredAt, dfLocale)}
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className={cn(
                              'h-1.5 w-1.5 flex-shrink-0 rounded-[2px]',
                              isIncome ? 'bg-positive' : 'bg-negative',
                            )}
                          />
                          <span className="wm-td--desc" title={displayDescription}>
                            {displayDescription}
                          </span>
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={row.categoryId ?? ''}
                          onChange={(v) => onRowCategoryChange(row.id, v)}
                          leadingOptions={row.kind === 'INCOME' ? rowCatLeadingIncome : rowCatLeadingExpense}
                          optionGroups={row.kind === 'INCOME' ? rowCatIncomeGroups : rowCatExpenseGroups}
                          placeholder={t('transactions.uncategorized')}
                          disabled={
                            updateCategoryMut.isPending &&
                            categoryUpdatingId === row.id
                          }
                          ariaLabel={t('transactions.categorySelectRowAria')}
                          minWidth={200}
                        />
                      </td>
                      <td className="wm-muted">
                        {row.sourceId
                          ? (sourceNameById.get(row.sourceId) ??
                            t('transactions.noSource'))
                          : t('transactions.noSource')}
                      </td>
                      <td
                        className={cn(
                          'wm-td--num text-right font-semibold',
                          isIncome ? 'text-positive' : 'text-fg',
                        )}
                      >
                        {isIncome ? '+' : '−'} {formatMoney(row.amount)}
                      </td>
                      <td className="wm-table__actions">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(t('transactions.deleteConfirm'))) {
                              deleteMut.mutate(row.id)
                            }
                          }}
                          disabled={deleteMut.isPending}
                        >
                          {t('transactions.delete')}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {list && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line-soft px-[18px] py-3 text-wm-sm">
            <span className="text-fg-muted">
              {t('transactions.pageOf', {
                page,
                totalPages,
                total: list.total,
              })}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('transactions.pagePrev')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('transactions.pageNext')}
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
