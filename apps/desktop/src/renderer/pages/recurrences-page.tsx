import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import type {
  Category,
  MaterializeRequest,
  MaterializeResponse,
  Recurrence,
  RecurrenceEndMode,
  RecurrenceFrequency,
  Source,
  TransactionKind,
} from '@wimm/shared'
import { addMonths } from 'date-fns'
import { apiClient } from '../lib/api-client'
import { PageHeader } from '../components/ui/page-header'
import { DatePicker } from '../components/ui/date-picker'
import { Select } from '../components/ui/select'
import { formatMediumDate, toIsoDate } from '../lib/dates'

const KIND_OPTIONS = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
]

const FREQ_OPTIONS = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
]

const END_MODE_OPTIONS = [
  { value: 'INDEFINITE', label: 'Never' },
  { value: 'UNTIL_DATE', label: 'On date' },
]

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function defaultUntilDate(): string {
  return toIsoDate(addMonths(new Date(), 3))
}

export function RecurrencesPage(): JSX.Element {
  const qc = useQueryClient()
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('MONTHLY')
  const [startDate, setStartDate] = useState(() => toIsoDate(new Date()))
  const [endMode, setEndMode] = useState<RecurrenceEndMode>('INDEFINITE')
  const [endDate, setEndDate] = useState('')
  const [until, setUntil] = useState(defaultUntilDate)
  const [materializeRecurrenceId, setMaterializeRecurrenceId] = useState('')

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

  const { data: recurrences = [], isLoading, error } = useQuery({
    queryKey: ['recurrences'],
    queryFn: async () => {
      const { data } = await apiClient.get<Recurrence[]>('/recurrences')
      return data
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount)
      if (Number.isNaN(amt) || amt < 0.01) {
        throw new Error('Enter a valid amount')
      }
      const body = {
        kind,
        amount: amt,
        description: description.trim(),
        frequency,
        startDate: `${startDate}T12:00:00.000Z`,
        endMode,
        ...(endMode === 'UNTIL_DATE'
          ? { endDate: `${endDate}T12:00:00.000Z` }
          : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(categoryId ? { categoryId } : {}),
      }
      const { data } = await apiClient.post<Recurrence>('/recurrences', body)
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
      setDescription('')
      setAmount('')
    },
  })

  const materializeMut = useMutation({
    mutationFn: async (payload: MaterializeRequest) => {
      const { data } = await apiClient.post<MaterializeResponse>(
        '/recurrences/materialize',
        payload,
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/recurrences/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const patchMut = useMutation({
    mutationFn: async (payload: { id: string; active: boolean }) => {
      const { data } = await apiClient.patch<Recurrence>(
        `/recurrences/${payload.id}`,
        { active: payload.active },
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const handleCreate = (e: FormEvent): void => {
    e.preventDefault()
    if (!description.trim()) return
    if (endMode === 'UNTIL_DATE' && !endDate) return
    createMut.mutate()
  }

  const handleMaterialize = (): void => {
    const body: MaterializeRequest = { until }
    if (materializeRecurrenceId) {
      body.recurrenceId = materializeRecurrenceId
    }
    materializeMut.mutate(body)
  }

  const sorted = useMemo(
    () => [...recurrences].sort((a, b) => a.description.localeCompare(b.description)),
    [recurrences],
  )

  const activeCount = sorted.filter((r) => r.active).length

  return (
    <div className="wm-page">
      <PageHeader
        eyebrow="Automation"
        title="Recurring transactions"
        subtitle="Rules are stored on the server. Generating materializes transactions up to a date; generated rows are never overwritten."
      />

      <section className="wm-panel">
        <header className="wm-panel__header">
          <div>
            <h2 className="wm-panel__title">Generate transactions</h2>
            <p className="wm-panel__sub">
              Create real transactions from active rules up to a given date.
            </p>
          </div>
        </header>

        <div className="wm-form-row">
          <div className="wm-field" style={{ flex: '1 1 200px' }}>
            <span>Until (inclusive)</span>
            <DatePicker value={until} onChange={setUntil} />
          </div>
          <div className="wm-field" style={{ flex: '2 1 260px' }}>
            <span>Only this rule (optional)</span>
            <Select
              value={materializeRecurrenceId}
              onChange={setMaterializeRecurrenceId}
              options={[
                { value: '', label: 'All active rules' },
                ...sorted.map((r) => ({
                  value: r.id,
                  label: `${r.description} (${r.frequency})`,
                })),
              ]}
              placeholder="All active rules"
              ariaLabel="Scope"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={handleMaterialize}
              disabled={materializeMut.isPending}
              className="wm-btn wm-btn--primary"
            >
              {materializeMut.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        {materializeMut.isSuccess && (
          <p className="wm-ok-text">
            Created {materializeMut.data.created} transaction(s).
          </p>
        )}
        {materializeMut.isError && (
          <p className="wm-error-text">Generation failed.</p>
        )}
      </section>

      <section className="wm-panel">
        <header className="wm-panel__header">
          <div>
            <h2 className="wm-panel__title">New rule</h2>
            <p className="wm-panel__sub">
              Templates that generate recurring transactions on a schedule.
            </p>
          </div>
        </header>

        <form onSubmit={handleCreate} className="wm-form-grid">
          <div className="wm-field">
            <span>Kind</span>
            <Select
              value={kind}
              onChange={(v) => setKind(v as TransactionKind)}
              options={KIND_OPTIONS}
              ariaLabel="Kind"
            />
          </div>
          <label className="wm-field">
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="wm-input wm-num"
            />
          </label>
          <label className="wm-field" style={{ gridColumn: 'span 2' }}>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="wm-input"
              placeholder="Rent, Netflix, Salary…"
            />
          </label>
          <div className="wm-field">
            <span>Frequency</span>
            <Select
              value={frequency}
              onChange={(v) => setFrequency(v as RecurrenceFrequency)}
              options={FREQ_OPTIONS}
              ariaLabel="Frequency"
            />
          </div>
          <div className="wm-field">
            <span>Start date</span>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div className="wm-field">
            <span>Ends</span>
            <Select
              value={endMode}
              onChange={(v) => setEndMode(v as RecurrenceEndMode)}
              options={END_MODE_OPTIONS}
              ariaLabel="End mode"
            />
          </div>
          {endMode === 'UNTIL_DATE' && (
            <div className="wm-field">
              <span>End date</span>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
          )}
          <div className="wm-field">
            <span>Source</span>
            <Select
              value={sourceId}
              onChange={setSourceId}
              options={[
                { value: '', label: 'None' },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
              placeholder="None"
              ariaLabel="Source"
            />
          </div>
          <div className="wm-field">
            <span>Category</span>
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: '', label: 'None' },
                ...categories
                  .filter((c) => c.type === kind)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
              placeholder="None"
              ariaLabel="Category"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="wm-btn wm-btn--primary"
            >
              {createMut.isPending ? 'Saving…' : 'Add rule'}
            </button>
          </div>
        </form>

        {createMut.error && (
          <p className="wm-error-text">
            {(createMut.error as Error).message ?? 'Could not create rule'}
          </p>
        )}
      </section>

      <section className="wm-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <header
          className="wm-panel__header"
          style={{ padding: 18, paddingBottom: 0 }}
        >
          <div>
            <h2 className="wm-panel__title">Your rules</h2>
            <p className="wm-panel__sub">
              {sorted.length === 0
                ? 'No recurrence rules yet.'
                : `${sorted.length} total · ${activeCount} active`}
            </p>
          </div>
        </header>

        <div style={{ padding: '14px 18px 0' }}>
          {error ? (
            <p className="wm-error-text">Failed to load recurrences.</p>
          ) : isLoading ? (
            <p className="wm-muted">Loading…</p>
          ) : sorted.length === 0 ? (
            <div className="wm-empty">
              <span>Add a recurring template above to get started.</span>
            </div>
          ) : (
            <div style={{ overflow: 'auto', margin: '0 -18px' }}>
              <table className="wm-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Active</th>
                    <th>Description</th>
                    <th>Kind</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Frequency</th>
                    <th>Start</th>
                    <th>Ends</th>
                    <th className="wm-table__actions" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="wm-check"
                          checked={r.active}
                          onChange={(e) =>
                            patchMut.mutate({
                              id: r.id,
                              active: e.target.checked,
                            })
                          }
                        />
                      </td>
                      <td>{r.description}</td>
                      <td>
                        <span
                          className={`wm-badge ${
                            r.kind === 'INCOME'
                              ? 'wm-badge--positive'
                              : 'wm-badge--negative'
                          }`}
                        >
                          {r.kind === 'INCOME' ? 'Income' : 'Expense'}
                        </span>
                      </td>
                      <td
                        className="wm-td--num"
                        style={{ textAlign: 'right', fontWeight: 600 }}
                      >
                        {formatMoney(r.amount)}
                      </td>
                      <td>
                        <span className="wm-badge">{r.frequency}</span>
                      </td>
                      <td className="wm-muted">
                        {formatMediumDate(r.startDate)}
                      </td>
                      <td className="wm-muted">
                        {r.endMode === 'UNTIL_DATE' && r.endDate
                          ? formatMediumDate(r.endDate)
                          : '—'}
                      </td>
                      <td className="wm-table__actions">
                        <button
                          type="button"
                          className="wm-btn wm-btn--danger"
                          onClick={() => {
                            if (
                              window.confirm(
                                'Delete this rule? Generated transactions stay in the register.',
                              )
                            ) {
                              deleteMut.mutate(r.id)
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
