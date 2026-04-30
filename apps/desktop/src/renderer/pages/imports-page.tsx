import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import {
  groupSourcesForImportSelect,
  type Category,
  type CommitImportRequest,
  type CommitImportResponse,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type Source,
} from '@wimm/shared'
import type { AxiosError } from 'axios'
import { apiClient } from '../lib/api-client'
import { buildCategoryOptionGroups } from '../lib/category-label'
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
  const [categoryByFingerprint, setCategoryByFingerprint] = useState<
    Record<string, string>
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

  const { leadingOptions: importCatLeadingExpense, optionGroups: importCatExpenseGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        filterType: 'EXPENSE',
        leadingLabel: t('transactions.uncategorized'),
      }),
    [categories, t],
  )
  const { leadingOptions: importCatLeadingIncome, optionGroups: importCatIncomeGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        filterType: 'INCOME',
        leadingLabel: t('transactions.uncategorized'),
      }),
    [categories, t],
  )

  const { bankAccounts, creditCards, other } = useMemo(
    () => groupSourcesForImportSelect(sources),
    [sources],
  )

  const sourceSelectGroups = useMemo(() => {
    const toOpt = (s: Source) => ({ value: s.id, label: s.name })
    const groups: { label: string; options: { value: string; label: string }[] }[] =
      []
    if (bankAccounts.length > 0) {
      groups.push({
        label: t('imports.sourceGroupBank'),
        options: bankAccounts.map(toOpt),
      })
    }
    if (creditCards.length > 0) {
      groups.push({
        label: t('imports.sourceGroupCreditCard'),
        options: creditCards.map(toOpt),
      })
    }
    if (other.length > 0) {
      groups.push({
        label: t('imports.sourceGroupOther'),
        options: other.map(toOpt),
      })
    }
    return groups
  }, [bankAccounts, creditCards, other, t])

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === sourceId),
    [sources, sourceId],
  )
  const showCreditCardImportNote = selectedSource?.type === 'CREDIT_CARD'

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
      const nextCat: Record<string, string> = {}
      for (const row of data.rows) {
        next[row.fingerprint] = !row.isDuplicate
        nextCat[row.fingerprint] = row.suggestedCategoryId ?? ''
      }
      setIncludeByFingerprint(next)
      setCategoryByFingerprint(nextCat)
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
      setCategoryByFingerprint({})
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
    const rows = selectedRows.map((r) => {
      const categoryId = categoryByFingerprint[r.fingerprint] ?? ''
      return {
        occurredAt: r.occurredAt,
        kind: r.kind,
        amount: Number.parseFloat(r.amount),
        description: r.description,
        ...(categoryId ? { categoryId } : {}),
        ...(r.installmentCurrent != null && r.installmentTotal != null
          ? {
              installmentCurrent: r.installmentCurrent,
              installmentTotal: r.installmentTotal,
            }
          : {}),
      }
    })
    if (rows.length === 0) return
    const body: CommitImportRequest = {
      sourceId,
      fileName: preview.fileName,
      format: preview.format,
      rows,
      ...(preview.statementBilling
        ? { statementBilling: preview.statementBilling }
        : {}),
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

        <form onSubmit={handlePreview} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3">
            <div className="min-w-0 flex-1">
              <Field label={t('imports.source')}>
                <Select
                  value={sourceId}
                  onChange={setSourceId}
                  leadingOptions={[
                    { value: '', label: t('imports.selectSource') },
                  ]}
                  optionGroups={sourceSelectGroups}
                  placeholder={t('imports.selectSource')}
                  required
                  ariaLabel={t('imports.source')}
                />
              </Field>
            </div>
            <div className="min-w-0 flex-1">
              <Field label={t('imports.fileLabel')}>
                <input
                  type="file"
                  accept=".csv,.ofx,.qfx,.pdf,application/pdf,text/csv,application/x-ofx,application/ofx"
                  onChange={(e) => {
                    setPreview(null)
                    setCategoryByFingerprint({})
                    setFile(e.target.files?.[0] ?? null)
                  }}
                  className="w-full cursor-pointer rounded-sm border border-dashed border-line bg-surface-2 px-2.5 py-2 text-wm-sm normal-case tracking-normal text-fg transition duration-wm-fast ease-wm hover:border-accent hover:bg-accent-soft"
                />
              </Field>
            </div>
            <div className="flex shrink-0 sm:pb-px">
              <Button
                type="submit"
                variant="primary"
                disabled={!file || !sourceId || previewMut.isPending}
                className="w-full sm:w-auto"
              >
                {previewMut.isPending
                  ? t('imports.parsing')
                  : t('imports.preview')}
              </Button>
            </div>
          </div>
          {showCreditCardImportNote ? (
            <p className="max-w-2xl text-wm-sm leading-relaxed text-fg-muted">
              {t('imports.creditCardImportDisclaimer')}
            </p>
          ) : null}
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

          {preview.parserWarnings && preview.parserWarnings.length > 0 ? (
            <details
              className="border-b border-line bg-surface-2 px-[18px] py-3"
              open
            >
              <summary className="cursor-pointer select-none text-wm-sm font-medium text-fg marker:text-fg">
                {t('imports.parserWarningsTitle')}{' '}
                <span className="font-normal text-fg-muted">
                  ({preview.parserWarnings.length})
                </span>
              </summary>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-wm-sm">
                {preview.parserWarnings.map((w, i) => {
                  const severity = w.severity ?? 'warning'
                  return (
                    <li
                      key={`${w.code}-${i}`}
                      className={
                        severity === 'info' ? 'text-fg-muted' : 'text-warning'
                      }
                    >
                      <span className="font-mono text-[0.7rem] opacity-90">
                        [{t(`imports.parserSeverity.${severity}`)}] {w.code}
                      </span>
                      <div className="mt-0.5 text-fg">{w.message}</div>
                      {w.rawBlock ?? w.rawLine ? (
                        <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-[0.65rem] text-fg-muted">
                          {w.rawBlock ?? w.rawLine}
                        </pre>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </details>
          ) : null}

          <div className="max-h-[55vh] overflow-auto">
            <table className="wm-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>{t('imports.colInclude')}</th>
                  <th>{t('imports.colDate')}</th>
                  <th>{t('imports.colKind')}</th>
                  <th className="text-right">{t('imports.colAmount')}</th>
                  <th>{t('imports.colDescription')}</th>
                  <th>{t('imports.colCategory')}</th>
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={categoryByFingerprint[row.fingerprint] ?? ''}
                          onChange={(v) => {
                            setCategoryByFingerprint((prev) => ({
                              ...prev,
                              [row.fingerprint]: v,
                            }))
                          }}
                          leadingOptions={isIncome ? importCatLeadingIncome : importCatLeadingExpense}
                          optionGroups={isIncome ? importCatIncomeGroups : importCatExpenseGroups}
                          placeholder={t('transactions.uncategorized')}
                          disabled={row.isDuplicate}
                          ariaLabel={t('transactions.categorySelectRowAria')}
                          minWidth={200}
                        />
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
                  setCategoryByFingerprint({})
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
