import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useState } from 'react'
import type {
  CategorizationMatchType,
  CategorizationRule,
  Category,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'

const MATCH_TYPES: { value: CategorizationMatchType; label: string }[] = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EQUALS', label: 'Equals' },
]

export function RulesPage(): JSX.Element {
  const qc = useQueryClient()
  const [priority, setPriority] = useState(10)
  const [matchType, setMatchType] =
    useState<CategorizationMatchType>('CONTAINS')
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const { data: rules = [], isLoading, error } = useQuery({
    queryKey: ['categorization-rules'],
    queryFn: async () => {
      const { data } = await apiClient.get<CategorizationRule[]>(
        '/categorization-rules',
      )
      return data
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/categorization-rules', {
        priority,
        matchType,
        pattern: pattern.trim(),
        categoryId,
      })
    },
    onSuccess: () => {
      setPattern('')
      void qc.invalidateQueries({ queryKey: ['categorization-rules'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categorization-rules/${id}`)
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['categorization-rules'] }),
  })

  const patchMut = useMutation({
    mutationFn: async (payload: { id: string; active: boolean }) => {
      await apiClient.patch(`/categorization-rules/${payload.id}`, {
        active: payload.active,
      })
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['categorization-rules'] }),
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!pattern.trim() || !categoryId) return
    createMut.mutate()
  }

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Categorization rules</h1>
      <p style={styles.lead}>
        First matching rule wins (lowest priority number first). Rules only
        apply when the category type matches the transaction kind (income vs
        expense). Description matching is case-insensitive.
      </p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Priority
          <input
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(Number.parseInt(e.target.value, 10) || 0)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Match
          <select
            value={matchType}
            onChange={(e) =>
              setMatchType(e.target.value as CategorizationMatchType)
            }
            style={styles.input}
          >
            {MATCH_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.labelWide}>
          Pattern
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Text in description"
            style={styles.input}
            required
          />
        </label>
        <label style={styles.labelWide}>
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            style={styles.input}
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={styles.btnPrimary}
          disabled={createMut.isPending || !categoryId}
        >
          Add rule
        </button>
      </form>

      {error && <p style={styles.err}>Failed to load rules.</p>}
      {isLoading ? (
        <p style={styles.muted}>Loading…</p>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>On</th>
                <th style={styles.th}>Priority</th>
                <th style={styles.th}>Match</th>
                <th style={styles.th}>Pattern</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={(e) =>
                        patchMut.mutate({ id: r.id, active: e.target.checked })
                      }
                    />
                  </td>
                  <td style={styles.td}>{r.priority}</td>
                  <td style={styles.td}>{r.matchType}</td>
                  <td style={styles.td}>{r.pattern}</td>
                  <td style={styles.td}>{r.category.name}</td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      style={styles.btnDanger}
                      onClick={() => {
                        if (window.confirm('Delete this rule?')) {
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
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 900 },
  h1: { fontSize: '1.25rem', marginBottom: '0.35rem' },
  lead: { color: '#888', fontSize: '0.875rem', marginBottom: '1rem' },
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
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
  labelWide: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8rem',
    color: '#aaa',
    minWidth: 160,
    flex: '1 1 180px',
  },
  input: {
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#ececec',
  },
  btnPrimary: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: 'none',
    background: '#3d5afe',
    color: '#fff',
    cursor: 'pointer',
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
  err: { color: '#f88' },
  muted: { color: '#666' },
  tableWrap: { overflow: 'auto', border: '1px solid #252525', borderRadius: 8 },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
  },
  th: {
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    borderBottom: '1px solid #252525',
    background: '#161616',
    color: '#bbb',
  },
  td: { padding: '0.45rem 0.65rem', color: '#ddd' },
}
