import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useCallback, useMemo, useState } from 'react'
import type {
  CommitImportRequest,
  CommitImportResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
  Source,
} from '@wimm/shared'
import type { AxiosError } from 'axios'
import { apiClient } from '../lib/api-client'

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(iso))
}

export function ImportsPage(): JSX.Element {
  const qc = useQueryClient()
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

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Import</h1>
      <p style={styles.lead}>
        Upload a CSV or OFX/QFX file, preview normalized rows, then save new
        transactions. Duplicates (same fingerprint as an existing transaction)
        are marked and excluded by default.
      </p>

      <form onSubmit={handlePreview} style={styles.form}>
        <label style={styles.label}>
          Source
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            required
            style={styles.input}
          >
            <option value="">Select a source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.label}>
          File (.csv, .ofx, .qfx)
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx,application/ofx"
            onChange={(e) => {
              setPreview(null)
              setFile(e.target.files?.[0] ?? null)
            }}
            style={styles.file}
          />
        </label>
        <button
          type="submit"
          disabled={!file || !sourceId || previewMut.isPending}
          style={styles.btnPrimary}
        >
          {previewMut.isPending ? 'Parsing…' : 'Preview'}
        </button>
      </form>

      {previewMut.error && (
        <p style={styles.err}>
          {previewErrorMessage(previewMut.error)}
        </p>
      )}

      {preview && (
        <section style={styles.section}>
          <div style={styles.summary}>
            <span>
              File: <strong>{preview.fileName}</strong> ({preview.format})
            </span>
            <span>
              Rows: {preview.totalParsed} · New: {preview.newCount} · Duplicates:{' '}
              {preview.duplicateCount}
            </span>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Include</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Kind</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const on = includeByFingerprint[row.fingerprint] ?? false
                  return (
                    <tr
                      key={row.fingerprint}
                      style={{
                        ...styles.tr,
                        opacity: row.isDuplicate && !on ? 0.55 : 1,
                      }}
                    >
                      <td style={styles.td}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleInclude(row)}
                          disabled={row.isDuplicate}
                          title={
                            row.isDuplicate
                              ? 'Duplicate — cannot import again'
                              : undefined
                          }
                        />
                      </td>
                      <td style={styles.td}>{formatWhen(row.occurredAt)}</td>
                      <td style={styles.td}>{row.kind}</td>
                      <td style={styles.td}>{formatMoney(row.amount)}</td>
                      <td style={styles.tdDesc}>{row.description}</td>
                      <td style={styles.td}>
                        {row.isDuplicate ? (
                          <span style={styles.badgeDup}>Duplicate</span>
                        ) : (
                          <span style={styles.badgeNew}>New</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={styles.actions}>
            <button
              type="button"
              onClick={handleCommit}
              disabled={!canCommit}
              style={styles.btnPrimary}
            >
              {commitMut.isPending
                ? 'Saving…'
                : `Import ${selectedRows.length} transaction(s)`}
            </button>
          </div>

          {lastCommit && (
            <p style={styles.ok}>
              Saved batch {lastCommit.importBatchId}: created {lastCommit.created}
              , skipped duplicates {lastCommit.skippedDuplicates}.
            </p>
          )}
          {commitMut.isError && (
            <p style={styles.err}>Import failed. Check the API and try again.</p>
          )}
        </section>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960 },
  h1: { fontSize: '1.35rem', marginBottom: '0.5rem' },
  lead: { color: '#9a9a9a', fontSize: '0.9rem', marginBottom: '1.25rem' },
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    alignItems: 'flex-end',
    marginBottom: '1.5rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8rem',
    color: '#aaa',
  },
  input: {
    minWidth: 220,
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#ececec',
  },
  file: { fontSize: '0.85rem' },
  btnPrimary: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: 'none',
    background: '#3d5afe',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  err: { color: '#f88', marginTop: '0.75rem' },
  ok: { color: '#8d8', marginTop: '0.75rem' },
  section: { marginTop: '1rem' },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    fontSize: '0.85rem',
    color: '#aaa',
    marginBottom: '0.75rem',
  },
  tableWrap: { overflow: 'auto', border: '1px solid #252525', borderRadius: 8 },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
  },
  th: {
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    borderBottom: '1px solid #252525',
    background: '#161616',
    color: '#bbb',
  },
  tr: { borderBottom: '1px solid #1e1e1e' },
  td: {
    padding: '0.45rem 0.65rem',
    verticalAlign: 'top',
    color: '#ddd',
  },
  tdDesc: {
    padding: '0.45rem 0.65rem',
    verticalAlign: 'top',
    color: '#ddd',
    maxWidth: 360,
    wordBreak: 'break-word',
  },
  badgeDup: {
    fontSize: '0.7rem',
    padding: '0.15rem 0.4rem',
    borderRadius: 4,
    background: '#4a3020',
    color: '#ecb',
  },
  badgeNew: {
    fontSize: '0.7rem',
    padding: '0.15rem 0.4rem',
    borderRadius: 4,
    background: '#203a30',
    color: '#cec',
  },
  actions: { marginTop: '1rem' },
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
