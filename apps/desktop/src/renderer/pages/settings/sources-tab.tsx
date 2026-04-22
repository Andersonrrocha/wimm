import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Source, SourceType } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  BANK_ACCOUNT: 'Bank account',
  CREDIT_CARD: 'Credit card',
  CASH: 'Cash',
  MANUAL: 'Manual',
}

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
  const qc = useQueryClient()

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
          <Panel.Title>Sources</Panel.Title>
          <Panel.Subtitle>
            Where transactions come from — accounts, cards, cash wallets, or
            manual entries.
          </Panel.Subtitle>
        </div>
        <Button variant="primary" onClick={onNewSource}>
          <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          New source
        </Button>
      </Panel.Header>

      {error ? (
        <p className="text-wm-sm text-negative">Failed to load sources.</p>
      ) : isLoading ? (
        <p className="text-wm-sm text-fg-muted">Loading…</p>
      ) : sources.length === 0 ? (
        <EmptyState>
          <span>
            Sources group transactions by origin. Add one before importing a
            statement.
          </span>
          <Button variant="primary" onClick={onNewSource}>
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
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <Badge variant={SOURCE_TYPE_VARIANT[s.type]}>
                      {SOURCE_TYPE_LABEL[s.type]}
                    </Badge>
                  </td>
                  <td className="wm-table__actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(`Delete "${s.name}"?`)) {
                          deleteMut.mutate(s.id)
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
