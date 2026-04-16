import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useMemo, useState } from 'react'
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
import { apiClient } from '../lib/api-client'

const KIND_OPTIONS: { value: TransactionKind; label: string }[] = [
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
]

const FREQ_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
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
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 3)
  return d.toISOString().slice(0, 10)
}

export function RecurrencesPage(): JSX.Element {
  const qc = useQueryClient()
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('MONTHLY')
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
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

  const { data: recurrences = [], isLoading } = useQuery({
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

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Recurring transactions</h1>
      <p style={styles.lead}>
        Rules are stored on the server. Use &quot;Generate&quot; to create
        transaction rows up to a date (existing generated rows are never
        overwritten).
      </p>

      <section style={styles.section}>
        <h2 style={styles.h2}>Generate transactions</h2>
        <div style={styles.row}>
          <label style={styles.label}>
            Until (inclusive)
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Only this rule (optional)
            <select
              value={materializeRecurrenceId}
              onChange={(e) => setMaterializeRecurrenceId(e.target.value)}
              style={styles.input}
            >
              <option value="">All active rules</option>
              {sorted.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.description} ({r.frequency})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleMaterialize}
            disabled={materializeMut.isPending}
            style={styles.btnPrimary}
          >
            {materializeMut.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {materializeMut.isSuccess && (
          <p style={styles.ok}>
            Created {materializeMut.data.created} transaction(s).
          </p>
        )}
        {materializeMut.isError && (
          <p style={styles.err}>Generation failed.</p>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>New rule</h2>
        <form onSubmit={handleCreate} style={styles.form}>
          <label style={styles.label}>
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TransactionKind)}
              style={styles.input}
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              style={styles.input}
            />
          </label>
          <label style={styles.labelWide}>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Frequency
            <select
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as RecurrenceFrequency)
              }
              style={styles.input}
            >
              {FREQ_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Ends
            <select
              value={endMode}
              onChange={(e) =>
                setEndMode(e.target.value as RecurrenceEndMode)
              }
              style={styles.input}
            >
              <option value="INDEFINITE">Never</option>
              <option value="UNTIL_DATE">On date</option>
            </select>
          </label>
          {endMode === 'UNTIL_DATE' && (
            <label style={styles.label}>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                style={styles.input}
              />
            </label>
          )}
          <label style={styles.label}>
            Source
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              style={styles.input}
            >
              <option value="">None</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Category
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={styles.input}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={createMut.isPending}
            style={styles.btnPrimary}
          >
            {createMut.isPending ? 'Saving…' : 'Add rule'}
          </button>
        </form>
        {createMut.error && (
          <p style={styles.err}>
            {(createMut.error as Error).message ?? 'Could not create rule'}
          </p>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Your rules</h2>
        {isLoading ? (
          <p style={styles.muted}>Loading…</p>
        ) : sorted.length === 0 ? (
          <p style={styles.muted}>No recurrence rules yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Active</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Kind</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Frequency</th>
                  <th style={styles.th}>Start</th>
                  <th style={styles.th}>Ends</th>
                  <th style={styles.th} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={r.active}
                        onChange={(e) =>
                          patchMut.mutate({ id: r.id, active: e.target.checked })
                        }
                      />
                    </td>
                    <td style={styles.td}>{r.description}</td>
                    <td style={styles.td}>{r.kind}</td>
                    <td style={styles.td}>{formatMoney(r.amount)}</td>
                    <td style={styles.td}>{r.frequency}</td>
                    <td style={styles.td}>
                      {new Date(r.startDate).toLocaleDateString()}
                    </td>
                    <td style={styles.td}>
                      {r.endMode === 'UNTIL_DATE' && r.endDate
                        ? new Date(r.endDate).toLocaleDateString()
                        : '—'}
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Delete this rule? Generated transactions stay in the register.',
                            )
                          ) {
                            deleteMut.mutate(r.id)
                          }
                        }}
                        style={styles.btnDanger}
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
      </section>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960 },
  h1: { fontSize: '1.35rem', marginBottom: '0.35rem' },
  h2: { fontSize: '1rem', marginBottom: '0.75rem', color: '#ccc' },
  lead: { color: '#9a9a9a', fontSize: '0.9rem', marginBottom: '1.25rem' },
  section: { marginBottom: '2rem' },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    alignItems: 'flex-end',
  },
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    alignItems: 'flex-end',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8rem',
    color: '#aaa',
  },
  labelWide: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8rem',
    color: '#aaa',
    minWidth: 200,
    flex: '1 1 200px',
  },
  input: {
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#ececec',
    minWidth: 120,
  },
  btnPrimary: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: 'none',
    background: '#3d5afe',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
    alignSelf: 'flex-end',
  },
  btnDanger: {
    padding: '0.25rem 0.5rem',
    borderRadius: 6,
    border: '1px solid #633',
    background: '#2a1818',
    color: '#ebb',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  err: { color: '#f88', marginTop: '0.5rem' },
  ok: { color: '#8d8', marginTop: '0.5rem' },
  muted: { color: '#888', fontSize: '0.9rem' },
  tableWrap: { overflow: 'auto', border: '1px solid #252525', borderRadius: 8 },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
  },
  th: {
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    borderBottom: '1px solid #252525',
    background: '#161616',
    color: '#bbb',
  },
  tr: { borderBottom: '1px solid #1e1e1e' },
  td: {
    padding: '0.45rem 0.65rem',
    verticalAlign: 'middle',
    color: '#ddd',
  },
}
