import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CategorizationMatchType,
  CategorizationRule,
  Category,
} from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { Select } from '../../components/ui/select'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Panel } from '../../components/ui/panel'

const MATCH_TYPES = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EQUALS', label: 'Equals' },
]

export function RulesTab(): JSX.Element {
  const { t } = useTranslation()
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
    <div className="flex flex-col gap-4">
      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>New rule</Panel.Title>
            <Panel.Subtitle>
              Rules apply on import and can be re-run anytime. Lowest priority
              number wins. Matching is case-insensitive.
            </Panel.Subtitle>
          </div>
        </Panel.Header>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
        >
          <Field label="Priority">
            <Input
              type="number"
              min={0}
              value={priority}
              onChange={(e) =>
                setPriority(Number.parseInt(e.target.value, 10) || 0)
              }
              className="wm-num"
            />
          </Field>
          <Field label="Match">
            <Select
              value={matchType}
              onChange={(v) => setMatchType(v as CategorizationMatchType)}
              options={MATCH_TYPES}
              ariaLabel="Match type"
            />
          </Field>
          <Field label="Pattern" className="col-span-2">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="Text in description"
              required
            />
          </Field>
          <Field label="Category" className="col-span-2">
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: '', label: 'Select…' },
                ...categories.map((c) => ({
                  value: c.id,
                  label: `${categoryDisplayName(c, t)} (${c.type === 'INCOME' ? 'income' : 'expense'})`,
                })),
              ]}
              placeholder="Select…"
              required
              ariaLabel="Category"
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              disabled={createMut.isPending || !categoryId}
            >
              {createMut.isPending ? 'Saving…' : 'Add rule'}
            </Button>
          </div>
        </form>
        {createMut.isError && (
          <p className="text-wm-sm text-negative">Could not create rule.</p>
        )}
      </Panel>

      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>Your rules</Panel.Title>
            <Panel.Subtitle>
              {rules.length === 0
                ? 'No rules yet.'
                : `${rules.length} rule${rules.length === 1 ? '' : 's'} — ${
                    rules.filter((r) => r.active).length
                  } active`}
            </Panel.Subtitle>
          </div>
        </Panel.Header>

        {error ? (
          <p className="text-wm-sm text-negative">Failed to load rules.</p>
        ) : isLoading ? (
          <p className="text-wm-sm text-fg-muted">Loading…</p>
        ) : rules.length === 0 ? (
          <EmptyState>
            <span>Add rules to auto-categorize imported transactions.</span>
          </EmptyState>
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
                      <Badge>{r.matchType}</Badge>
                    </td>
                    <td className="wm-td--desc">{r.pattern}</td>
                    <td>{categoryDisplayName(r.category, t)}</td>
                    <td className="wm-table__actions">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (window.confirm('Delete this rule?')) {
                            deleteMut.mutate(r.id)
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
