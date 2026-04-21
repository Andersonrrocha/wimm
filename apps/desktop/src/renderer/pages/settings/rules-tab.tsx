import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type {
  CategorizationMatchType,
  CategorizationRule,
  Category,
} from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { Select } from '../../components/ui/select'

const MATCH_TYPES = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EQUALS', label: 'Equals' },
]

export function RulesTab(): JSX.Element {
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

  const {
    data: rules = [],
    isLoading,
    error,
  } = useQuery({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="wm-panel">
        <header className="wm-panel__header">
          <div>
            <h2 className="wm-panel__title">New rule</h2>
            <p className="wm-panel__sub">
              Rules apply on import and can be re-run anytime. Lowest priority
              number wins. Matching is case-insensitive.
            </p>
          </div>
        </header>
        <form onSubmit={handleSubmit} className="wm-form-grid">
          <label className="wm-field">
            Priority
            <input
              type="number"
              min={0}
              value={priority}
              onChange={(e) =>
                setPriority(Number.parseInt(e.target.value, 10) || 0)
              }
              className="wm-input wm-num"
            />
          </label>
          <div className="wm-field">
            <span>Match</span>
            <Select
              value={matchType}
              onChange={(v) => setMatchType(v as CategorizationMatchType)}
              options={MATCH_TYPES}
              ariaLabel="Match type"
            />
          </div>
          <label className="wm-field" style={{ gridColumn: 'span 2' }}>
            Pattern
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="Text in description"
              className="wm-input"
              required
            />
          </label>
          <div className="wm-field" style={{ gridColumn: 'span 2' }}>
            <span>Category</span>
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: '', label: 'Select…' },
                ...categories.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.type === 'INCOME' ? 'income' : 'expense'})`,
                })),
              ]}
              placeholder="Select…"
              required
              ariaLabel="Category"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="submit"
              className="wm-btn wm-btn--primary"
              disabled={createMut.isPending || !categoryId}
            >
              {createMut.isPending ? 'Saving…' : 'Add rule'}
            </button>
          </div>
        </form>
        {createMut.isError && (
          <p className="wm-error-text">Could not create rule.</p>
        )}
      </section>

      <section className="wm-panel">
        <header className="wm-panel__header">
          <div>
            <h2 className="wm-panel__title">Your rules</h2>
            <p className="wm-panel__sub">
              {rules.length === 0
                ? 'No rules yet.'
                : `${rules.length} rule${rules.length === 1 ? '' : 's'} — ${
                    rules.filter((r) => r.active).length
                  } active`}
            </p>
          </div>
        </header>

        {error ? (
          <p className="wm-error-text">Failed to load rules.</p>
        ) : isLoading ? (
          <p className="wm-muted">Loading…</p>
        ) : rules.length === 0 ? (
          <div className="wm-empty">
            <span>Add rules to auto-categorize imported transactions.</span>
          </div>
        ) : (
          <div className="wm-table-wrap">
            <table className="wm-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Active</th>
                  <th style={{ width: 88 }}>Priority</th>
                  <th style={{ width: 110 }}>Match</th>
                  <th>Pattern</th>
                  <th>Category</th>
                  <th className="wm-table__actions" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
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
                    <td className="wm-td--num">{r.priority}</td>
                    <td>
                      <span className="wm-badge">{r.matchType}</span>
                    </td>
                    <td className="wm-td--desc">{r.pattern}</td>
                    <td>{r.category.name}</td>
                    <td className="wm-table__actions">
                      <button
                        type="button"
                        className="wm-btn wm-btn--danger"
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
      </section>
    </div>
  )
}
