import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Category } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'

interface CategoriesTabProps {
  onNewCategory: () => void
}

export function CategoriesTab({
  onNewCategory,
}: CategoriesTabProps): JSX.Element {
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
    <section className="wm-panel">
      <header className="wm-panel__header">
        <div>
          <h2 className="wm-panel__title">Categories</h2>
          <p className="wm-panel__sub">
            {categories.length === 0
              ? 'No categories yet.'
              : `${categories.length} total · ${incomeCount} income · ${expenseCount} expense`}
          </p>
        </div>
        <button
          type="button"
          className="wm-btn wm-btn--primary"
          onClick={onNewCategory}
        >
          + New category
        </button>
      </header>

      {error ? (
        <p className="wm-error-text">Failed to load categories.</p>
      ) : isLoading ? (
        <p className="wm-muted">Loading…</p>
      ) : categories.length === 0 ? (
        <div className="wm-empty">
          <span>
            Categories classify transactions as income or expense. They also
            power categorization rules.
          </span>
          <button
            type="button"
            className="wm-btn wm-btn--primary"
            onClick={onNewCategory}
          >
            Create your first
          </button>
        </div>
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
                  <td>{c.name}</td>
                  <td>
                    <span
                      className={`wm-badge wm-badge--${
                        c.type === 'INCOME' ? 'positive' : 'negative'
                      }`}
                    >
                      {c.type === 'INCOME' ? 'Income' : 'Expense'}
                    </span>
                  </td>
                  <td className="wm-table__actions">
                    <button
                      type="button"
                      className="wm-btn wm-btn--danger"
                      onClick={() => {
                        if (window.confirm(`Delete "${c.name}"?`)) {
                          deleteMut.mutate(c.id)
                        }
                      }}
                      disabled={deleteMut.isPending}
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
  )
}
