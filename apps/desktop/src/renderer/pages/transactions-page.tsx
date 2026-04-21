import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type {
  Category,
  PaginatedResponse,
  Source,
  Transaction,
  TransactionKind,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'
import { PageHeader } from '../components/ui/page-header'
import { DatePicker } from '../components/ui/date-picker'
import { Select } from '../components/ui/select'
import type { QuickAddTab } from '../components/quick-add-modal'
import { formatDateTime, formatShortDate, toIsoDate } from '../lib/dates'

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

type KindFilter = 'ALL' | TransactionKind

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function TransactionsPage(): JSX.Element {
  const qc = useQueryClient()
  const { openQuickAdd } = useOutletContext<OutletCtx>()

  const [from, setFrom] = useState(() => toIsoDate(startOfMonth(new Date())))
  const [to, setTo] = useState(() => toIsoDate(endOfMonth(new Date())))
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [categoryId, setCategoryId] = useState('')
  const [sourceId, setSourceId] = useState('')
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
    const params: Record<string, string | number> = { page, pageSize }
    if (from) params.from = from
    if (to) params.to = to
    if (categoryId) params.categoryId = categoryId
    if (sourceId) params.sourceId = sourceId
    return params
  }, [page, from, to, categoryId, sourceId])

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

  const items = list?.items ?? []
  const filtered = useMemo(() => {
    if (kind === 'ALL') return items
    return items.filter((t) => t.kind === kind)
  }, [items, kind])

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

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

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'All categories' },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  )

  const sourceOptions = useMemo(
    () => [
      { value: '', label: 'All sources' },
      ...sources.map((s) => ({ value: s.id, label: s.name })),
    ],
    [sources],
  )

  return (
    <div className="wm-page">
      <PageHeader
        eyebrow="Register"
        title="Transactions"
        subtitle={`${list?.total ?? '…'} records in range · ${formatShortDate(from)} → ${formatShortDate(to)}`}
        actions={
          <button
            type="button"
            className="wm-btn wm-btn--primary"
            onClick={() => openQuickAdd('transaction')}
          >
            + New transaction
          </button>
        }
      />

      <section className="wm-panel">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 12,
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div className="wm-field">
              <span>From</span>
              <DatePicker
                value={from}
                onChange={(v) => {
                  setFrom(v)
                  resetPage()
                }}
                minWidth={160}
              />
            </div>
            <div className="wm-field">
              <span>To</span>
              <DatePicker
                value={to}
                onChange={(v) => {
                  setTo(v)
                  resetPage()
                }}
                minWidth={160}
              />
            </div>
            <div className="wm-field">
              <span>Category</span>
              <Select
                value={categoryId}
                onChange={(v) => {
                  setCategoryId(v)
                  resetPage()
                }}
                options={categoryOptions}
                placeholder="All categories"
                minWidth={170}
                ariaLabel="Category filter"
              />
            </div>
            <div className="wm-field">
              <span>Source</span>
              <Select
                value={sourceId}
                onChange={(v) => {
                  setSourceId(v)
                  resetPage()
                }}
                options={sourceOptions}
                placeholder="All sources"
                minWidth={170}
                ariaLabel="Source filter"
              />
            </div>
          </div>

          <div
            role="group"
            aria-label="Kind filter"
            style={{ display: 'flex', gap: 6 }}
          >
            {(['ALL', 'INCOME', 'EXPENSE'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`wm-chip${kind === k ? ' wm-chip--active' : ''}`}
              >
                {k === 'ALL' ? 'All' : k === 'INCOME' ? 'Income' : 'Expense'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="wm-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {error ? (
          <p className="wm-error-text" style={{ padding: 18 }}>
            Failed to load transactions.
          </p>
        ) : isLoading ? (
          <p className="wm-muted" style={{ padding: 18 }}>
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <div className="wm-empty" style={{ padding: 24 }}>
            <span>No transactions match these filters.</span>
            <button
              type="button"
              className="wm-btn wm-btn--primary"
              onClick={() => openQuickAdd('transaction')}
            >
              Add a transaction
            </button>
          </div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table className="wm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th className="wm-table__actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const isIncome = t.kind === 'INCOME'
                  return (
                    <tr key={t.id}>
                      <td className="wm-muted">{formatDateTime(t.occurredAt)}</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            aria-hidden
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 2,
                              background: isIncome
                                ? 'var(--wm-positive)'
                                : 'var(--wm-negative)',
                              flexShrink: 0,
                            }}
                          />
                          <span className="wm-td--desc" title={t.description}>
                            {t.description || 'Untitled'}
                          </span>
                        </span>
                      </td>
                      <td className="wm-muted">
                        {t.categoryId
                          ? categoryNameById.get(t.categoryId) ?? '—'
                          : '—'}
                      </td>
                      <td className="wm-muted">
                        {t.sourceId
                          ? sourceNameById.get(t.sourceId) ?? '—'
                          : '—'}
                      </td>
                      <td
                        className="wm-td--num"
                        style={{
                          textAlign: 'right',
                          color: isIncome
                            ? 'var(--wm-positive)'
                            : 'var(--wm-text)',
                          fontWeight: 600,
                        }}
                      >
                        {isIncome ? '+' : '−'} {formatMoney(t.amount)}
                      </td>
                      <td className="wm-table__actions">
                        <button
                          type="button"
                          className="wm-btn wm-btn--danger"
                          onClick={() => {
                            if (window.confirm('Delete this transaction?')) {
                              deleteMut.mutate(t.id)
                            }
                          }}
                          disabled={deleteMut.isPending}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {list && totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              borderTop: '1px solid var(--wm-border-soft)',
              fontSize: 'var(--wm-fs-sm)',
            }}
          >
            <span className="wm-muted">
              Page {page} of {totalPages} · {list.total} total
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="wm-btn wm-btn--ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="wm-btn wm-btn--ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
