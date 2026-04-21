import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import type {
  Category,
  CategoryType,
  Source,
  SourceType,
  TransactionKind,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'
import { fromIsoDate, toIsoDate } from '../lib/dates'
import { Modal } from './ui/modal'
import { Tabs } from './ui/tabs'
import { Select } from './ui/select'
import { DatePicker } from './ui/date-picker'

interface QuickAddModalProps {
  open: boolean
  onClose: () => void
  initialTab?: QuickAddTab
}

export type QuickAddTab = 'transaction' | 'category' | 'source'

const SOURCE_TYPE_OPTIONS = [
  { value: 'BANK_ACCOUNT', label: 'Bank account' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'MANUAL', label: 'Manual' },
]

const CATEGORY_TYPE_OPTIONS = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
]

function nowAsTime(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Single surface for creating a transaction, a category, or a source.
 * Keeps friction low: opens from any page, reuses react-query caches.
 */
export function QuickAddModal({
  open,
  onClose,
  initialTab = 'transaction',
}: QuickAddModalProps): JSX.Element {
  const [tab, setTab] = useState<QuickAddTab>(initialTab)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  return (
    <Modal open={open} onClose={onClose} title="Add to your register" maxWidth={620}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as QuickAddTab)} defaultValue={tab}>
        <Tabs.List ariaLabel="Quick add">
          <Tabs.Trigger value="transaction">Transaction</Tabs.Trigger>
          <Tabs.Trigger value="category">Category</Tabs.Trigger>
          <Tabs.Trigger value="source">Source</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Panel value="transaction">
          <TransactionForm onDone={onClose} />
        </Tabs.Panel>
        <Tabs.Panel value="category">
          <CategoryForm onDone={onClose} />
        </Tabs.Panel>
        <Tabs.Panel value="source">
          <SourceForm onDone={onClose} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

function TransactionForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient()
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [time, setTime] = useState(() => nowAsTime())
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

  const relevantCategories = categories.filter((c) => c.type === kind)

  const sourceOptions = [
    { value: '', label: 'None' },
    ...sources.map((s) => ({ value: s.id, label: s.name })),
  ]
  const categoryOptions = [
    { value: '', label: 'None' },
    ...relevantCategories.map((c) => ({ value: c.id, label: c.name })),
  ]

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount)
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Invalid amount')
      const parsed = fromIsoDate(date)
      if (!parsed) throw new Error('Invalid date')
      const [h, m] = time.split(':').map((s) => Number.parseInt(s, 10) || 0)
      parsed.setHours(h, m, 0, 0)
      await apiClient.post('/transactions', {
        kind,
        amount: amt,
        description: description.trim(),
        occurredAt: parsed.toISOString(),
        sourceId: sourceId || undefined,
        categoryId: categoryId || undefined,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!description.trim()) return
    createMut.mutate()
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <KindToggle value={kind} onChange={setKind} />

      <div style={rowStyle}>
        <label className="wm-field" style={{ flex: '1 1 180px' }}>
          Amount
          <input
            className="wm-input wm-num"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
            autoFocus
          />
        </label>
        <label className="wm-field" style={{ flex: '2 1 260px' }}>
          Description
          <input
            className="wm-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="What was it?"
          />
        </label>
      </div>

      <div style={rowStyle}>
        <div className="wm-field" style={{ flex: '1 1 200px' }}>
          <span>Date</span>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <label className="wm-field" style={{ flex: '0 0 120px' }}>
          Time
          <input
            className="wm-input wm-num"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </label>
        <div className="wm-field" style={{ flex: '1 1 180px' }}>
          <span>Source</span>
          <Select
            value={sourceId}
            onChange={setSourceId}
            options={sourceOptions}
            placeholder="None"
            ariaLabel="Source"
          />
        </div>
        <div className="wm-field" style={{ flex: '1 1 180px' }}>
          <span>Category</span>
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={categoryOptions}
            placeholder="None"
            ariaLabel="Category"
          />
        </div>
      </div>

      <FooterRow>
        {createMut.isError ? (
          <span style={errStyle}>Could not save.</span>
        ) : (
          <span style={{ color: 'var(--wm-text-soft)', fontSize: 'var(--wm-fs-xs)' }}>
            Press ⌘/Ctrl + Enter to save.
          </span>
        )}
        <button
          type="submit"
          className="wm-btn wm-btn--primary"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? 'Saving…' : 'Save transaction'}
        </button>
      </FooterRow>
    </form>
  )
}

function CategoryForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<CategoryType>('EXPENSE')

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/categories', { name: name.trim(), type })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <div style={rowStyle}>
        <label className="wm-field" style={{ flex: '2 1 240px' }}>
          Name
          <input
            className="wm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Groceries, Salary…"
          />
        </label>
        <div className="wm-field" style={{ flex: '1 1 160px' }}>
          <span>Type</span>
          <Select
            value={type}
            onChange={(v) => setType(v as CategoryType)}
            options={CATEGORY_TYPE_OPTIONS}
            ariaLabel="Category type"
          />
        </div>
      </div>

      <FooterRow>
        {createMut.isError ? (
          <span style={errStyle}>Could not save.</span>
        ) : (
          <span style={{ color: 'var(--wm-text-soft)', fontSize: 'var(--wm-fs-xs)' }}>
            Categories classify both income and expense.
          </span>
        )}
        <button
          type="submit"
          className="wm-btn wm-btn--primary"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? 'Saving…' : 'Save category'}
        </button>
      </FooterRow>
    </form>
  )
}

function SourceForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<SourceType>('BANK_ACCOUNT')

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/sources', { name: name.trim(), type })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sources'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <div style={rowStyle}>
        <label className="wm-field" style={{ flex: '2 1 240px' }}>
          Name
          <input
            className="wm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Itaú checking, Nubank card…"
          />
        </label>
        <div className="wm-field" style={{ flex: '1 1 160px' }}>
          <span>Type</span>
          <Select
            value={type}
            onChange={(v) => setType(v as SourceType)}
            options={SOURCE_TYPE_OPTIONS}
            ariaLabel="Source type"
          />
        </div>
      </div>

      <FooterRow>
        {createMut.isError ? (
          <span style={errStyle}>Could not save.</span>
        ) : (
          <span style={{ color: 'var(--wm-text-soft)', fontSize: 'var(--wm-fs-xs)' }}>
            Sources are where transactions come from.
          </span>
        )}
        <button
          type="submit"
          className="wm-btn wm-btn--primary"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? 'Saving…' : 'Save source'}
        </button>
      </FooterRow>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function KindToggle({
  value,
  onChange,
}: {
  value: TransactionKind
  onChange: (v: TransactionKind) => void
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Transaction kind"
      style={{
        display: 'inline-flex',
        padding: 4,
        background: 'var(--wm-surface-2)',
        border: '1px solid var(--wm-border-soft)',
        borderRadius: 'var(--wm-radius-md)',
      }}
    >
      <KindOption
        kind="EXPENSE"
        label="Expense"
        active={value === 'EXPENSE'}
        color="var(--wm-negative)"
        onClick={() => onChange('EXPENSE')}
      />
      <KindOption
        kind="INCOME"
        label="Income"
        active={value === 'INCOME'}
        color="var(--wm-positive)"
        onClick={() => onChange('INCOME')}
      />
    </div>
  )
}

function KindOption({
  label,
  active,
  color,
  onClick,
}: {
  kind: TransactionKind
  label: string
  active: boolean
  color: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '0.45rem 0.9rem',
        borderRadius: 6,
        fontSize: 'var(--wm-fs-sm)',
        color: active ? color : 'var(--wm-text-muted)',
        background: active ? 'var(--wm-surface-3)' : 'transparent',
        fontWeight: active ? 600 : 400,
        transition: 'color 140ms, background 140ms',
      }}
    >
      {label}
    </button>
  )
}

function FooterRow({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginTop: 4,
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared styles                                                       */
/* ------------------------------------------------------------------ */

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
}

const errStyle: CSSProperties = {
  color: 'var(--wm-negative)',
  fontSize: 'var(--wm-fs-xs)',
}
