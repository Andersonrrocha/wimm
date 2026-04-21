import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Source, SourceType } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  BANK_ACCOUNT: 'Bank account',
  CREDIT_CARD: 'Credit card',
  CASH: 'Cash',
  MANUAL: 'Manual',
}

const SOURCE_TYPE_BADGE: Record<SourceType, string> = {
  BANK_ACCOUNT: 'wm-badge--neutral',
  CREDIT_CARD: 'wm-badge--accent',
  CASH: 'wm-badge--positive',
  MANUAL: '',
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
    <section className="wm-panel">
      <header className="wm-panel__header">
        <div>
          <h2 className="wm-panel__title">Sources</h2>
          <p className="wm-panel__sub">
            Where transactions come from — accounts, cards, cash wallets, or
            manual entries.
          </p>
        </div>
        <button
          type="button"
          className="wm-btn wm-btn--primary"
          onClick={onNewSource}
        >
          + New source
        </button>
      </header>

      {error ? (
        <p className="wm-error-text">Failed to load sources.</p>
      ) : isLoading ? (
        <p className="wm-muted">Loading…</p>
      ) : sources.length === 0 ? (
        <div className="wm-empty">
          <span>
            Sources group transactions by origin. Add one before importing a
            statement.
          </span>
          <button
            type="button"
            className="wm-btn wm-btn--primary"
            onClick={onNewSource}
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
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <span
                      className={`wm-badge ${SOURCE_TYPE_BADGE[s.type] ?? ''}`.trim()}
                    >
                      {SOURCE_TYPE_LABEL[s.type]}
                    </span>
                  </td>
                  <td className="wm-table__actions">
                    <button
                      type="button"
                      className="wm-btn wm-btn--danger"
                      onClick={() => {
                        if (window.confirm(`Delete "${s.name}"?`)) {
                          deleteMut.mutate(s.id)
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
