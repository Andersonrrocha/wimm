import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Source, SourceType } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'

const SOURCE_TYPE_VARIANT: Record<SourceType, BadgeVariant> = {
  BANK_ACCOUNT: 'neutral',
  CREDIT_CARD: 'accent',
  CASH: 'positive',
  MANUAL: 'neutral',
}

interface SourcesTabProps {
  onNewSource: () => void
}

export function SourcesTab({ onNewSource }: SourcesTabProps): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const sourceTypeLabel = (type: SourceType): string =>
    t(`quickAdd.sourceType.${type}`)

  const {
    data: sources = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/sources/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sources'] }),
  })

  return (
    <Panel>
      <Panel.Header>
        <div>
          <Panel.Title>{t('sourcesTab.title')}</Panel.Title>
          <Panel.Subtitle>{t('sourcesTab.subtitle')}</Panel.Subtitle>
        </div>
        <Button variant="primary" onClick={onNewSource}>
          <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          {t('sourcesTab.newSource')}
        </Button>
      </Panel.Header>

      {error ? (
        <p className="text-wm-sm text-negative">{t('sourcesTab.failedLoad')}</p>
      ) : isLoading ? (
        <p className="text-wm-sm text-fg-muted">{t('common.loading')}</p>
      ) : sources.length === 0 ? (
        <EmptyState>
          <span>{t('sourcesTab.emptyBody')}</span>
          <Button variant="primary" onClick={onNewSource}>
            {t('sourcesTab.createFirst')}
          </Button>
        </EmptyState>
      ) : (
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th>{t('sourcesTab.name')}</th>
                <th>{t('sourcesTab.type')}</th>
                <th>{t('sourcesTab.billingCycleCol')}</th>
                <th className="wm-table__actions" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <Badge variant={SOURCE_TYPE_VARIANT[s.type]}>
                      {sourceTypeLabel(s.type)}
                    </Badge>
                  </td>
                  <td className="text-wm-sm text-fg-muted">
                    {s.type === 'CREDIT_CARD' &&
                    s.closingDay != null &&
                    s.dueDay != null ? (
                      t('sourcesTab.billingCycleValue', {
                        closing: s.closingDay,
                        due: s.dueDay,
                      })
                    ) : s.type === 'CREDIT_CARD' ? (
                      t('sourcesTab.billingCycleIncomplete')
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="wm-table__actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            t('sourcesTab.deleteConfirm', { name: s.name }),
                          )
                        ) {
                          deleteMut.mutate(s.id)
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
