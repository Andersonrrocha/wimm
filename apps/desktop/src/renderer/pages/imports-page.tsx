import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import type {
  Category,
  CommitImportRequest,
  CommitImportResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
  Source,
} from '@wimm/shared'
import type { AxiosError } from 'axios'
import { apiClient } from '../lib/api-client'
import { PageHeader } from '../components/ui/page-header'
import { Select } from '../components/ui/select'
import { formatMediumDate } from '../lib/dates'
import type { QuickAddTab } from '../components/quick-add-modal'

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function ImportsPage(): JSX.Element {
  const qc = useQueryClient()
  const { openQuickAdd } = useOutletContext<OutletCtx>()
  const [sourceId, setSourceId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [includeByFingerprint, setIncludeByFingerprint] = useState<
    Record<string, boolean>
  >({})
  const [lastCommit, setLastCommit] = useState<CommitImportResponse | null>(null)

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const previewMut = useMutation({
    mutationFn: async (payload: { file: File; sourceId: string }) => {
      const form = new FormData()
      form.append('file', payload.file)
      form.append('sourceId', payload.sourceId)
      const { data } = await apiClient.post<ImportPreviewResponse>(
        '/imports/preview',
        form,
      )
      return data
    },
    onSuccess: (data) => {
      setPreview(data)
      const next: Record<string, boolean> = {}
      for (const row of data.rows) {
        next[row.fingerprint] = !row.isDuplicate
      }
      setIncludeByFingerprint(next)
    },
  })

  const commitMut = useMutation({
    mutationFn: async (body: CommitImportRequest) => {
      const { data } = await apiClient.post<CommitImportResponse>(
        '/imports/commit',
        body,
      )
      return data
    },
    onSuccess: async (data) => {
      setLastCommit(data)
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
      setPreview(null)
      setFile(null)
      setIncludeByFingerprint({})
    },
  })

  const selectedRows = useMemo(() => {
    if (!preview) return []
    return preview.rows.filter((r) => includeByFingerprint[r.fingerprint])
  }, [preview, includeByFingerprint])

  const canCommit =
    preview &&
    selectedRows.length > 0 &&
    !commitMut.isPending &&
    !previewMut.isPending

  const handlePreview = (e: FormEvent): void => {
    e.preventDefault()
    if (!file || !sourceId) return
    setLastCommit(null)
    previewMut.mutate({ file, sourceId })
  }

  const handleCommit = (): void => {
    if (!preview || !sourceId) return
    const rows = selectedRows.map((r) => ({
      occurredAt: r.occurredAt,
      kind: r.kind,
      amount: Number.parseFloat(r.amount),
      description: r.description,
      ...(r.suggestedCategoryId
        ? { categoryId: r.suggestedCategoryId }
        : {}),
    }))
    if (rows.length === 0) return
    const body: CommitImportRequest = {
      sourceId,
      fileName: preview.fileName,
      format: preview.format,
      rows,
    }
    commitMut.mutate(body)
  }

  const toggleInclude = useCallback((row: ImportPreviewRow) => {
    setIncludeByFingerprint((prev) => ({
      ...prev,
      [row.fingerprint]: !prev[row.fingerprint],
    }))
  }, [])

  const toggleAll = (select: boolean): void => {
    if (!preview) return
    const next: Record<string, boolean> = {}
    for (const row of preview.rows) {
      next[row.fingerprint] = select && !row.isDuplicate
    }
    setIncludeByFingerprint(next)
  }

  return (
    <div className="wm-page">
      <PageHeader
        eyebrow="Batch"
        title="Import statement"
        subtitle="Upload a CSV or OFX/QFX file. Rows are normalized, categorization rules are applied, and duplicates are excluded by default."
      />

      <section className="wm-panel">
        <header className="wm-panel__header">
          <div>
            <h2 className="wm-panel__title">Upload file</h2>
            <p className="wm-panel__sub">
              Need a new source?{' '}
              <button
                type="button"
                className="wm-link"
                onClick={() => openQuickAdd('source')}
              >
                Create one
              </button>
              .
            </p>
          </div>
        </header>

        <form onSubmit={handlePreview} className="wm-form-row">
          <div className="wm-field" style={{ flex: '1 1 220px' }}>
            <span>Source</span>
            <Select
              value={sourceId}
              onChange={setSourceId}
              options={[
                { value: '', label: 'Select a source' },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
              placeholder="Select a source"
              required
              ariaLabel="Source"
            />
          </div>
          <label className="wm-field" style={{ flex: '2 1 300px' }}>
            File (.csv, .ofx, .qfx)
            <input
              type="file"
              accept=".csv,.ofx,.qfx,text/csv,application/x-ofx,application/ofx"
              onChange={(e) => {
                setPreview(null)
                setFile(e.target.files?.[0] ?? null)
              }}
              className="wm-file"
            />
          </label>
          <div>
            <button
              type="submit"
              className="wm-btn wm-btn--primary"
              disabled={!file || !sourceId || previewMut.isPending}
            >
              {previewMut.isPending ? 'Parsing…' : 'Preview'}
            </button>
          </div>
        </form>

        {previewMut.error && (
          <p className="wm-error-text">
            {previewErrorMessage(previewMut.error)}
          </p>
        )}
        {lastCommit && (
          <p className="wm-ok-text">
            Saved batch · created {lastCommit.created} · skipped duplicates{' '}
            {lastCommit.skippedDuplicates}.
          </p>
        )}
      </section>

      {preview && (
        <section className="wm-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <header
            className="wm-panel__header"
            style={{ padding: 18, paddingBottom: 14 }}
          >
            <div>
              <h2 className="wm-panel__title">
                {preview.fileName}{' '}
                <span className="wm-badge wm-badge--neutral">
                  {preview.format}
                </span>
              </h2>
              <p className="wm-panel__sub">
                {preview.totalParsed} rows parsed ·{' '}
                <span style={{ color: 'var(--wm-positive)' }}>
                  {preview.newCount} new
                </span>{' '}
                ·{' '}
                <span style={{ color: 'var(--wm-warning)' }}>
                  {preview.duplicateCount} duplicates
                </span>
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="wm-btn wm-btn--subtle"
                onClick={() => toggleAll(true)}
              >
                Select new
              </button>
              <button
                type="button"
                className="wm-btn wm-btn--subtle"
                onClick={() => toggleAll(false)}
              >
                Clear all
              </button>
            </div>
          </header>

          <div style={{ overflow: 'auto', maxHeight: '55vh' }}>
            <table className="wm-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Incl.</th>
                  <th>Date</th>
                  <th>Kind</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Description</th>
                  <th>Suggested</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const on = includeByFingerprint[row.fingerprint] ?? false
                  const isIncome = row.kind === 'INCOME'
                  return (
                    <tr
                      key={row.fingerprint}
                      style={{
                        opacity: row.isDuplicate && !on ? 0.55 : 1,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="wm-check"
                          checked={on}
                          onChange={() => toggleInclude(row)}
                          disabled={row.isDuplicate}
                          title={
                            row.isDuplicate
                              ? 'Duplicate — already in your register'
                              : undefined
                          }
                        />
                      </td>
                      <td className="wm-muted">{formatMediumDate(row.occurredAt)}</td>
                      <td>
                        <span
                          className={`wm-badge ${
                            isIncome
                              ? 'wm-badge--positive'
                              : 'wm-badge--negative'
                          }`}
                        >
                          {isIncome ? 'Income' : 'Expense'}
                        </span>
                      </td>
                      <td
                        className="wm-td--num"
                        style={{ textAlign: 'right', fontWeight: 600 }}
                      >
                        {formatMoney(row.amount)}
                      </td>
                      <td className="wm-td--desc">{row.description}</td>
                      <td className="wm-muted">
                        {row.suggestedCategoryId
                          ? categoryNameById.get(row.suggestedCategoryId) ??
                            row.suggestedCategoryId
                          : '—'}
                      </td>
                      <td>
                        {row.isDuplicate ? (
                          <span className="wm-badge wm-badge--warning">
                            Duplicate
                          </span>
                        ) : (
                          <span className="wm-badge wm-badge--positive">
                            New
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 18px',
              borderTop: '1px solid var(--wm-border-soft)',
            }}
          >
            <span className="wm-muted">
              {selectedRows.length} selected of {preview.rows.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="wm-btn wm-btn--ghost"
                onClick={() => {
                  setPreview(null)
                  setFile(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={!canCommit}
                className="wm-btn wm-btn--primary"
              >
                {commitMut.isPending
                  ? 'Saving…'
                  : `Import ${selectedRows.length}`}
              </button>
            </div>
          </div>

          {commitMut.isError && (
            <p className="wm-error-text" style={{ padding: '0 18px 14px' }}>
              Import failed. Check the API and try again.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function previewErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const ax = err as AxiosError<{ message?: string | string[] }>
    const m = ax.response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (err instanceof Error) return err.message
  return 'Preview failed'
}
