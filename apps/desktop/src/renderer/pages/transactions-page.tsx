import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useMemo, useState } from 'react'
import type {
  Category,
  PaginatedResponse,
  Source,
  Transaction,
  TransactionKind,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'

const KIND_OPTIONS: { value: TransactionKind; label: string }[] = [
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
]

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TransactionsPage(): JSX.Element {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue(new Date()))
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')

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

  const { data: list, isLoading, error } = useQuery({
    queryKey: ['transactions', page],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<Transaction>>('/transactions', {
        params: { page, pageSize: 20 },
      })
      return data
    },
  })

  const items = list?.items ?? []
  const totalPages = useMemo(() => {
    if (!list) return 1
    return Math.max(1, Math.ceil(list.total / list.pageSize))
  }, [list])

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount)
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Invalid amount')
      await apiClient.post('/transactions', {
        kind,
        amount: amt,
        description: description.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
        sourceId: sourceId || undefined,
        categoryId: categoryId || undefined,
      })
    },
    onSuccess: () => {
      setAmount('')
      setDescription('')
      setOccurredAt(toDatetimeLocalValue(new Date()))
      setSourceId('')
      setCategoryId('')
      void qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/transactions/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['transactions'] }),
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    createMut.mutate()
  }

  return (
    <div>
      <h2 style={h2}>Transactions</h2>
      <p style={muted}>Manual entries with optional source and category.</p>

      <form onSubmit={handleSubmit} style={formGrid}>
        <label style={label}>
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TransactionKind)}
            style={input}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={label}>
          Amount
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={input}
            required
          />
        </label>
        <label style={labelWide}>
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={input}
            required
          />
        </label>
        <label style={label}>
          When
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            style={input}
            required
          />
        </label>
        <label style={label}>
          Source
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={input}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={label}>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={input}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div style={formActions}>
          <button type="submit" style={btnPrimary} disabled={createMut.isPending}>
            Add transaction
          </button>
          {createMut.isError && <span style={err}>Could not save.</span>}
        </div>
      </form>

      {error && <p style={err}>Failed to load transactions.</p>}
      {isLoading && <p style={muted}>Loading…</p>}

      <table style={table}>
        <thead>
          <tr>
            <th style={th}>When</th>
            <th style={th}>Kind</th>
            <th style={th}>Amount</th>
            <th style={th}>Description</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td style={td}>{formatWhen(t.occurredAt)}</td>
              <td style={td}>{t.kind}</td>
              <td style={td}>{formatMoney(t.amount)}</td>
              <td style={td}>{t.description}</td>
              <td style={td}>
                <button
                  type="button"
                  style={btnDanger}
                  onClick={() => deleteMut.mutate(t.id)}
                  disabled={deleteMut.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {list && totalPages > 1 && (
        <div style={pager}>
          <button
            type="button"
            style={btnGhost}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={muted}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            style={btnGhost}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

const h2: CSSProperties = { fontSize: '1.25rem', margin: '0 0 0.5rem' }
const muted: CSSProperties = { color: '#888', fontSize: '0.875rem' }
const err: CSSProperties = { color: '#f87171', fontSize: '0.8rem' }
const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: '0.75rem',
  marginBottom: '1.5rem',
  alignItems: 'end',
}
const label: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.75rem',
  color: '#aaa',
}
const labelWide: CSSProperties = {
  ...label,
  gridColumn: 'span 2',
}
const input: CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: '0.45rem 0.65rem',
  color: '#ececec',
  fontSize: '0.875rem',
}
const formActions: CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
}
const btnPrimary: CSSProperties = {
  background: '#6366f1',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  padding: '0.45rem 0.85rem',
  cursor: 'pointer',
  fontSize: '0.875rem',
  width: 'fit-content',
}
const btnDanger: CSSProperties = {
  background: 'transparent',
  border: '1px solid #5c2b2b',
  color: '#f87171',
  borderRadius: 6,
  padding: '0.25rem 0.5rem',
  cursor: 'pointer',
  fontSize: '0.75rem',
}
const btnGhost: CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  color: '#ccc',
  borderRadius: 6,
  padding: '0.35rem 0.65rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
}
const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '1px solid #2a2a2a',
  color: '#aaa',
}
const td: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid #1e1e1e',
}
const pager: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  marginTop: '1rem',
}
