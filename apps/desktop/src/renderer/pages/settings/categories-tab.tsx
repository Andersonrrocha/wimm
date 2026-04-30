import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Category } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'

function categoryHierarchyLabel(
  c: Pick<import('@wimm/shared').Category, 'name' | 'categoryKey' | 'parentId' | 'parent'>,
  t: import('i18next').TFunction,
): string {
  const childLabel = categoryDisplayName(c, t)
  if (c.parent) {
    const parentLabel = categoryDisplayName(c.parent, t)
    return `${childLabel} (${parentLabel})`
  }
  return childLabel
}
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

  // Display parents before their children, ordered by name within each group.
  const sorted = useMemo(() => {
    const parents = categories.filter((c) => !c.parentId)
    const childrenByParent = new Map<string, typeof categories>()
    for (const c of categories) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId) ?? []
        arr.push(c)
        childrenByParent.set(c.parentId, arr)
      }
    }
    const result: typeof categories = []
    for (const p of parents) {
      result.push(p)
      const children = childrenByParent.get(p.id) ?? []
      result.push(...children.sort((a, b) => a.name.localeCompare(b.name)))
    }
    return result
  }, [categories])

  return (
    <Panel>
      <Panel.Header>
        <div>
          <Panel.Title>{t('categoriesTab.title')}</Panel.Title>
          <Panel.Subtitle>
            {categories.length === 0
              ? t('categoriesTab.subtitleEmpty')
              : t('categoriesTab.subtitle', {
                  total: categories.length,
                  income: incomeCount,
                  expense: expenseCount,
                })}
          </Panel.Subtitle>
        </div>
        <Button variant="primary" onClick={onNewCategory}>
          <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          {t('categoriesTab.newCategory')}
        </Button>
      </Panel.Header>

      {error ? (
        <p className="text-wm-sm text-negative">{t('categoriesTab.failedLoad')}</p>
      ) : isLoading ? (
        <p className="text-wm-sm text-fg-muted">{t('common.loading')}</p>
      ) : categories.length === 0 ? (
        <EmptyState>
          <span>{t('categoriesTab.emptyBody')}</span>
          <Button variant="primary" onClick={onNewCategory}>
            {t('categoriesTab.createFirst')}
          </Button>
        </EmptyState>
      ) : (
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th>{t('categoriesTab.name')}</th>
                <th>{t('categoriesTab.type')}</th>
                <th className="wm-table__actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id}>
                  <td
                    style={c.parentId ? { paddingLeft: '2rem' } : undefined}
                  >
                    {categoryHierarchyLabel(c, t)}
                  </td>
                  <td>
                    <Badge
                      variant={c.type === 'INCOME' ? 'positive' : 'negative'}
                    >
                      {c.type === 'INCOME'
                        ? t('quickAdd.categoryType.INCOME')
                        : t('quickAdd.categoryType.EXPENSE')}
                    </Badge>
                  </td>
                  <td className="wm-table__actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            t('categoriesTab.deleteConfirm', {
                              name: categoryHierarchyLabel(c, t),
                            }),
                          )
                        ) {
                          deleteMut.mutate(c.id)
                        }
                      }}
                      disabled={deleteMut.isPending}
                    >
                      {t('transactions.delete')}
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
