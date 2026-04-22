import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Category } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'

interface CategoriesTabProps {
  onNewCategory: () => void
}

export function CategoriesTab({
  onNewCategory,
}: CategoriesTabProps): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const {
    data: categories = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categories/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  })

  const incomeCount = categories.filter((c) => c.type === 'INCOME').length
  const expenseCount = categories.filter((c) => c.type === 'EXPENSE').length

  return (
    <Panel>
      <Panel.Header>
        <div>
          <Panel.Title>Categories</Panel.Title>
          <Panel.Subtitle>
            {categories.length === 0
              ? 'No categories yet.'
              : `${categories.length} total · ${incomeCount} income · ${expenseCount} expense`}
          </Panel.Subtitle>
        </div>
        <Button variant="primary" onClick={onNewCategory}>
          <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          New category
        </Button>
      </Panel.Header>

      {error ? (
        <p className="text-wm-sm text-negative">Failed to load categories.</p>
      ) : isLoading ? (
        <p className="text-wm-sm text-fg-muted">Loading…</p>
      ) : categories.length === 0 ? (
        <EmptyState>
          <span>
            Categories classify transactions as income or expense. They also
            power categorization rules.
          </span>
          <Button variant="primary" onClick={onNewCategory}>
            Create your first
          </Button>
        </EmptyState>
      ) : (
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th className="wm-table__actions" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{categoryDisplayName(c, t)}</td>
                  <td>
                    <Badge
                      variant={c.type === 'INCOME' ? 'positive' : 'negative'}
                    >
                      {c.type === 'INCOME' ? 'Income' : 'Expense'}
                    </Badge>
                  </td>
                  <td className="wm-table__actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${categoryDisplayName(c, t)}"?`,
                          )
                        ) {
                          deleteMut.mutate(c.id)
                        }
                      }}
                      disabled={deleteMut.isPending}
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
  )
}
