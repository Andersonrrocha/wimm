import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
import { categoryDisplayName } from '../lib/category-label'
import { PageHeader } from '../components/ui/page-header'
import { Select } from '../components/ui/select'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Panel } from '../components/ui/panel'
import { dateFnsLocaleForLang } from '../lib/date-fns-locale'
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
  const { t, i18n } = useTranslation()
  const dfLocale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )
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
    for (const c of categories) m.set(c.id, categoryDisplayName(c, t))
    return m
  }, [categories, t])

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
    <div className="mx-auto flex max-w-container flex-col gap-6">
      <PageHeader
        eyebrow={t('imports.eyebrow')}
        title={t('imports.statementTitle')}
        subtitle={t('imports.statementSubtitle')}
      />

      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>{t('imports.uploadTitle')}</Panel.Title>
            <Panel.Subtitle>
              {t('imports.needSource')}{' '}
              <button
                type="button"
                className="wm-link"
                onClick={() => openQuickAdd('source')}
              >
                {t('imports.createOne')}
              </button>
              .
            </Panel.Subtitle>
          </div>
        </Panel.Header>

        <form
          onSubmit={handlePreview}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label={t('imports.source')} className="basis-[220px] grow">
            <Select
              value={sourceId}
              onChange={setSourceId}
              options={[
                { value: '', label: t('imports.selectSource') },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
              placeholder={t('imports.selectSource')}
              required
              ariaLabel={t('imports.source')}
            />
          </Field>
          <Field
            label={t('imports.fileLabel')}
            className="basis-[300px] grow-[2]"
          >
            <input
              type="file"
              accept=".csv,.ofx,.qfx,text/csv,application/x-ofx,application/ofx"
              onChange={(e) => {
                setPreview(null)
                setFile(e.target.files?.[0] ?? null)
              }}
              className="cursor-pointer rounded-sm border border-dashed border-line bg-surface-2 px-2.5 py-2 text-wm-sm normal-case tracking-normal text-fg transition duration-wm-fast ease-wm hover:border-accent hover:bg-accent-soft"
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={!file || !sourceId || previewMut.isPending}
            >
              {previewMut.isPending ? t('imports.parsing') : t('imports.preview')}
            </Button>
          </div>
        </form>

        {previewMut.error && (
          <p className="text-wm-sm text-negative">
            {previewErrorMessage(previewMut.error, t('imports.previewFailed'))}
          </p>
        )}
        {lastCommit && (
          <p className="text-wm-sm text-positive">
            {t('imports.commitSuccess', {
              created: lastCommit.created,
              skipped: lastCommit.skippedDuplicates,
            })}
          </p>
        )}
      </Panel>

      {preview && (
        <Panel flush className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] pb-3.5 pt-[18px]">
            <div>
              <Panel.Title>
                {preview.fileName} <Badge variant="neutral">{preview.format}</Badge>
              </Panel.Title>
              <Panel.Subtitle>
                {t('imports.rowsParsedLead', { parsed: preview.totalParsed })} ·{' '}
                <span className="text-positive">
                  {t('imports.rowsParsedNew', { count: preview.newCount })}
                </span>
                {' · '}
                <span className="text-warning">
                  {t('imports.rowsParsedDup', {
                    count: preview.duplicateCount,
                  })}
                </span>
              </Panel.Subtitle>
            </div>
            <div className="flex gap-2">
              <Button variant="subtle" size="sm" onClick={() => toggleAll(true)}>
                {t('imports.selectNew')}
              </Button>
              <Button variant="subtle" size="sm" onClick={() => toggleAll(false)}>
                {t('imports.clearAll')}
              </Button>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-auto">
            <table className="wm-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>{t('imports.colInclude')}</th>
                  <th>{t('imports.colDate')}</th>
                  <th>{t('imports.colKind')}</th>
                  <th className="text-right">{t('imports.colAmount')}</th>
                  <th>{t('imports.colDescription')}</th>
                  <th>{t('imports.colSuggested')}</th>
                  <th>{t('imports.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const on = includeByFingerprint[row.fingerprint] ?? false
                  const isIncome = row.kind === 'INCOME'
                  return (
                    <tr
                      key={row.fingerprint}
                      className={
                        row.isDuplicate && !on ? 'opacity-55' : undefined
                      }
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
                              ? t('imports.duplicateTooltip')
                              : undefined
                          }
                        />
                      </td>
                      <td className="wm-muted">
                        {formatMediumDate(row.occurredAt, dfLocale)}
                      </td>
                      <td>
                        <Badge variant={isIncome ? 'positive' : 'negative'}>
                          {isIncome
                            ? t('transactions.kindIncome')
                            : t('transactions.kindExpense')}
                        </Badge>
                      </td>
                      <td className="wm-td--num text-right font-semibold">
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
                          <Badge variant="warning">
                            {t('imports.badgeDuplicate')}
                          </Badge>
                        ) : (
                          <Badge variant="positive">{t('imports.badgeNew')}</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line-soft px-[18px] py-3.5">
            <span className="text-wm-sm text-fg-muted">
              {t('imports.selectedOf', {
                selected: selectedRows.length,
                total: preview.rows.length,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null)
                  setFile(null)
                }}
              >
                {t('imports.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleCommit}
                disabled={!canCommit}
              >
                {commitMut.isPending
                  ? t('quickAdd.saving')
                  : t('imports.importCount', {
                      count: selectedRows.length,
                    })}
              </Button>
            </div>
          </div>

          {commitMut.isError && (
            <p className="px-[18px] pb-3.5 text-wm-sm text-negative">
              {t('imports.commitError')}
            </p>
          )}
        </Panel>
      )}
    </div>
  )
}

function previewErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const ax = err as AxiosError<{ message?: string | string[] }>
    const m = ax.response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (err instanceof Error) return err.message
  return fallback
}
