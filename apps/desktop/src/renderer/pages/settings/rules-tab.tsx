import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CategorizationMatchType,
  CategorizationRule,
  Category,
} from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { buildCategoryOptionGroups } from '../../lib/category-label'
import { Select } from '../../components/ui/select'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Panel } from '../../components/ui/panel'

export function RulesTab(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const matchTypeOptions = useMemo(
    () => [
      { value: 'CONTAINS' as const, label: t('rulesTab.matchContains') },
      { value: 'EQUALS' as const, label: t('rulesTab.matchEquals') },
    ],
    [t],
  )
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

  const { leadingOptions: ruleCatLeading, optionGroups: ruleCatGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        leadingLabel: t('rulesTab.selectPlaceholder'),
      }),
    [categories, t],
  )

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
            <Panel.Title>{t('rulesTab.newRuleTitle')}</Panel.Title>
            <Panel.Subtitle>{t('rulesTab.newRuleSubtitle')}</Panel.Subtitle>
          </div>
        </Panel.Header>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
        >
          <Field label={t('rulesTab.priority')}>
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
          <Field label={t('rulesTab.match')}>
            <Select
              value={matchType}
              onChange={(v) => setMatchType(v as CategorizationMatchType)}
              options={matchTypeOptions}
              ariaLabel={t('rulesTab.matchTypeAria')}
            />
          </Field>
          <Field label={t('rulesTab.pattern')} className="col-span-2">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t('rulesTab.patternPlaceholder')}
              required
            />
          </Field>
          <Field label={t('rulesTab.category')} className="col-span-2">
            <Select
              value={categoryId}
              onChange={setCategoryId}
              leadingOptions={ruleCatLeading}
              optionGroups={ruleCatGroups}
              placeholder={t('rulesTab.selectPlaceholder')}
              required
              ariaLabel={t('rulesTab.categoryAria')}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              disabled={createMut.isPending || !categoryId}
            >
              {createMut.isPending
                ? t('rulesTab.saving')
                : t('rulesTab.addRule')}
            </Button>
          </div>
        </form>
        {createMut.isError && (
          <p className="text-wm-sm text-negative">{t('rulesTab.createFailed')}</p>
        )}
      </Panel>

      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>{t('rulesTab.yourRulesTitle')}</Panel.Title>
            <Panel.Subtitle>
              {rules.length === 0
                ? t('rulesTab.rulesSubtitleEmpty')
                : t('rulesTab.rulesSubtitle', {
                    total: rules.length,
                    active: rules.filter((r) => r.active).length,
                  })}
            </Panel.Subtitle>
          </div>
        </Panel.Header>

        {error ? (
          <p className="text-wm-sm text-negative">{t('rulesTab.failedLoad')}</p>
        ) : isLoading ? (
          <p className="text-wm-sm text-fg-muted">{t('common.loading')}</p>
        ) : rules.length === 0 ? (
          <EmptyState>
            <span>{t('rulesTab.emptyHint')}</span>
          </EmptyState>
        ) : (
          <div className="wm-table-wrap">
            <table className="wm-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>{t('rulesTab.colActive')}</th>
                  <th style={{ width: 88 }}>{t('rulesTab.colPriority')}</th>
                  <th style={{ width: 110 }}>{t('rulesTab.colMatch')}</th>
                  <th>{t('rulesTab.colPattern')}</th>
                  <th>{t('rulesTab.colCategory')}</th>
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
                      <Badge>
                        {r.matchType === 'CONTAINS'
                          ? t('rulesTab.matchContains')
                          : r.matchType === 'EQUALS'
                            ? t('rulesTab.matchEquals')
                            : r.matchType}
                      </Badge>
                    </td>
                    <td className="wm-td--desc">{r.pattern}</td>
                    <td>{categoryDisplayName(r.category, t)}</td>
                    <td className="wm-table__actions">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (window.confirm(t('rulesTab.deleteConfirm'))) {
                            deleteMut.mutate(r.id)
                          }
                        }}
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
    </div>
  )
}
