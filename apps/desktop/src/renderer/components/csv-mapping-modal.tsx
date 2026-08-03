import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { apiClient } from '../lib/api-client'
import { dateFnsLocaleForLang } from '../lib/date-fns-locale'
import { formatMediumDate } from '../lib/dates'
import {
  buildColumnIndexOptions,
  classifyCsvMappingWarning,
  confidenceBadgeVariant,
  formatSignedMoney,
  splitRawPreviewLines,
} from '../lib/csv-mapping-format'
import { Modal } from './ui/modal'
import { Field } from './ui/field'
import { Select, type SelectOption } from './ui/select'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import type {
  CsvMapping,
  CsvMappingApplyResult,
  CsvMappingProposal,
} from '../../shared/csv-mapping-protocol'

/**
 * The CSV column-mapping screen (Stage 2 task 5): a column picker over a
 * real preview of the user's actual file, not an abstract form. Sits
 * *before* the existing `/imports/preview` -> `/imports/commit` flow
 * (`imports-page.tsx`) -- this screen only ever proposes, previews, and
 * saves a `GenericCsvMapping` for a source; it never itself imports
 * anything. Once saved, the existing preview endpoint picks the saved
 * mapping up automatically (`ImportsService.preview`) -- there is exactly
 * one place a CSV is ever actually parsed for commit, and this screen is not
 * it.
 *
 * Detection (`window.csvMapping.propose`) and the live preview
 * (`window.csvMapping.apply`) both run as pure functions in main (see
 * `main/csv-mapping-bridge.ts`) -- reading and saving the confirmed mapping
 * still goes through the existing `GET`/`PUT /imports/csv-mapping/:sourceId`
 * HTTP routes, via the same single `apiClient` instance every other page
 * uses.
 */

interface StoredCsvSourceMapping {
  mapping: CsvMapping
  columnCount: number
}

export interface CsvMappingModalProps {
  open: boolean
  onClose: () => void
  sourceId: string
  sourceName: string
  file: File
  /** Called once the mapping has actually been saved -- the caller invalidates/refreshes whatever depends on it. */
  onSaved?: () => void
}

const DEFAULT_MAPPING: CsvMapping = {
  delimiter: ',',
  hasHeader: true,
  encoding: 'utf8',
  dateColumn: 0,
  descriptionColumn: 1,
  decimalSeparator: '.',
  dateOrder: 'DMY',
  sign: { kind: 'signed_amount', amountColumn: 2 },
}

function mappingFromProposal(p: CsvMappingProposal): CsvMapping {
  return {
    delimiter: p.delimiter.value,
    hasHeader: p.hasHeader.value,
    encoding: p.encoding.value,
    dateColumn: p.dateColumn.value ?? 0,
    descriptionColumn: p.descriptionColumn.value ?? 1,
    decimalSeparator: p.decimalSeparator.value,
    dateOrder: p.dateOrder.value,
    sign: p.sign.value ?? { kind: 'signed_amount', amountColumn: 2 },
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const ax = err as AxiosError<{ message?: string | string[] }>
    const m = ax.response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** Rebuilds `sign` for a newly chosen `kind`, keeping `amountColumn` when both the old and new kind have one. */
function defaultSignForKind(
  kind: CsvMapping['sign']['kind'],
  current: CsvMapping['sign'],
  columnCount: number,
): CsvMapping['sign'] {
  const fallbackCol = (offset: number): number =>
    Math.max(0, Math.min(offset, Math.max(columnCount - 1, 0)))
  const currentAmountColumn =
    'amountColumn' in current ? current.amountColumn : fallbackCol(2)

  if (kind === 'signed_amount') {
    return { kind: 'signed_amount', amountColumn: currentAmountColumn }
  }
  if (kind === 'debit_credit') {
    return {
      kind: 'debit_credit',
      debitColumn: fallbackCol(2),
      creditColumn: fallbackCol(3),
    }
  }
  return {
    kind: 'amount_and_type',
    amountColumn: currentAmountColumn,
    typeColumn: fallbackCol(3),
    debitValues: ['D', 'DEBIT', 'DEBITO'],
    creditValues: ['C', 'CREDIT', 'CREDITO'],
  }
}

const MAX_PREVIEW_ROWS = 50

/** The subset of `CsvMappingProposal`'s keys that are actually `FieldGuess`es -- excludes `overallConfidence`/`sampledRows`/`columnCount`. */
type ProposalFieldKey =
  | 'delimiter'
  | 'hasHeader'
  | 'encoding'
  | 'dateColumn'
  | 'descriptionColumn'
  | 'decimalSeparator'
  | 'dateOrder'
  | 'sign'

export function CsvMappingModal({
  open,
  onClose,
  sourceId,
  sourceName,
  file,
  onSaved,
}: CsvMappingModalProps): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const dfLocale = useMemo(() => dateFnsLocaleForLang(i18n.language), [i18n.language])
  const qc = useQueryClient()

  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [mapping, setMapping] = useState<CsvMapping>(DEFAULT_MAPPING)
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [applyResult, setApplyResult] = useState<CsvMappingApplyResult | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<CsvMappingProposal | null>(null)
  const [proposeError, setProposeError] = useState<string | null>(null)

  // Reset every piece of per-file state whenever the modal opens (or the
  // file it was opened for changes) -- never carry a previous file's
  // detection/preview into a new one.
  useEffect(() => {
    if (!open) return
    setFileBytes(null)
    setMapping(DEFAULT_MAPPING)
    setEditedFields(new Set())
    setInitialized(false)
    setApplyResult(null)
    setApplyError(null)
    setProposal(null)
    setProposeError(null)

    let cancelled = false
    void file.arrayBuffer().then((buf) => {
      if (!cancelled) setFileBytes(new Uint8Array(buf))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file])

  const savedMappingQuery = useQuery({
    queryKey: ['csvSourceMapping', sourceId],
    queryFn: async () => {
      const { data } = await apiClient.get<StoredCsvSourceMapping | null>(
        `/imports/csv-mapping/${sourceId}`,
      )
      return data
    },
    enabled: open && !!sourceId,
  })
  const hasSavedMapping = !!savedMappingQuery.data

  // Detection only ever runs while there is no saved mapping to prefer
  // instead -- a saved mapping is user-confirmed truth (see the
  // initialization effect below); re-detecting against it would be wasted
  // work and a confusing second opinion.
  useEffect(() => {
    if (!open || !fileBytes) return
    if (savedMappingQuery.isLoading || savedMappingQuery.data) return
    let cancelled = false
    window.csvMapping
      .propose(fileBytes)
      .then((p) => {
        if (!cancelled) setProposal(p)
      })
      .catch((e: unknown) => {
        if (!cancelled) setProposeError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [open, fileBytes, savedMappingQuery.isLoading, savedMappingQuery.data])

  // Initializes the editable mapping exactly once per open: the saved
  // mapping if one exists, otherwise the freshly detected proposal (or the
  // hard-coded default, if detection itself failed -- the user can still
  // fill in every field by hand from there).
  useEffect(() => {
    if (initialized || !open) return
    if (savedMappingQuery.isLoading) return
    if (savedMappingQuery.data) {
      setMapping(savedMappingQuery.data.mapping)
      setInitialized(true)
      return
    }
    if (proposal) {
      setMapping(mappingFromProposal(proposal))
      setInitialized(true)
      return
    }
    if (proposeError) {
      setInitialized(true)
    }
  }, [initialized, open, savedMappingQuery.isLoading, savedMappingQuery.data, proposal, proposeError])

  // The live preview -- re-parses the file under the *current* mapping
  // every time it changes, debounced so a fast sequence of edits (typing a
  // debit/credit token list, say) does not fire one IPC round trip per
  // keystroke. This is the whole point of Stage 2's plan: a wrong decimal
  // separator or date order must become a visibly wrong number here, before
  // anything is saved or imported.
  useEffect(() => {
    if (!open || !fileBytes || !initialized) return
    const handle = setTimeout(() => {
      window.csvMapping
        .apply(fileBytes, mapping)
        .then((result) => {
          setApplyResult(result)
          setApplyError(null)
        })
        .catch((e: unknown) => {
          setApplyResult(null)
          setApplyError(errorMessage(e))
        })
    }, 150)
    return () => clearTimeout(handle)
  }, [open, fileBytes, mapping, initialized])

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!applyResult) {
        throw new Error(t('imports.mapping.noPreviewYet'))
      }
      const { data } = await apiClient.put<StoredCsvSourceMapping>(
        `/imports/csv-mapping/${sourceId}`,
        { ...mapping, columnCount: applyResult.columnCount },
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['csvSourceMapping', sourceId] })
      onSaved?.()
      onClose()
    },
  })

  const rawPreviewText = useMemo(() => {
    if (!fileBytes) return ''
    try {
      // Cosmetic decode for the raw-lines panel only -- helps the user count
      // columns and pick the right index. The authoritative decode (which
      // decides what actually gets imported) always happens in main, via
      // `window.csvMapping.apply` -> `applyGenericCsvMapping`. See
      // `splitRawPreviewLines`'s doc comment.
      const decoder = new TextDecoder(
        mapping.encoding === 'latin1' ? 'iso-8859-1' : 'utf-8',
      )
      return decoder.decode(fileBytes)
    } catch {
      return ''
    }
  }, [fileBytes, mapping.encoding])

  const rawPreviewRows = useMemo(
    () => splitRawPreviewLines(rawPreviewText, mapping.delimiter, 8),
    [rawPreviewText, mapping.delimiter],
  )

  const columnCount = Math.max(
    applyResult?.columnCount ?? 0,
    rawPreviewRows.reduce((max, r) => Math.max(max, r.length), 0),
  )
  const columnOptions: SelectOption[] = useMemo(
    () => buildColumnIndexOptions(columnCount),
    [columnCount],
  )

  function markEdited(field: string): void {
    setEditedFields((prev) => {
      if (prev.has(field)) return prev
      const next = new Set(prev)
      next.add(field)
      return next
    })
  }

  function update<K extends keyof CsvMapping>(field: K, value: CsvMapping[K]): void {
    markEdited(field)
    setMapping((m) => ({ ...m, [field]: value }))
  }

  /** Confidence badge + reason for one top-level mapping field -- `null` once the mapping is a saved/confirmed one, or once the user has edited that field themselves. */
  function renderGuessHint(field: ProposalFieldKey): JSX.Element | null {
    if (hasSavedMapping) return null
    if (editedFields.has(field)) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="neutral">{t('imports.mapping.confirmedByYou')}</Badge>
        </span>
      )
    }
    if (!proposal) return null
    const guess = proposal[field]
    return (
      <span className="flex flex-col gap-1">
        <Badge variant={confidenceBadgeVariant(guess.confidence)}>
          {t(`imports.mapping.confidenceBadge.${guess.confidence}`)}
        </Badge>
        <span className="text-wm-xs normal-case tracking-normal text-fg-muted">
          {guess.reason}
        </span>
      </span>
    )
  }

  if (!open) return null

  const delimiterOptions: SelectOption[] = [
    { value: ',', label: t('imports.mapping.delimiterComma') },
    { value: ';', label: t('imports.mapping.delimiterSemicolon') },
  ]
  const encodingOptions: SelectOption[] = [
    { value: 'utf8', label: t('imports.mapping.encodingUtf8') },
    { value: 'latin1', label: t('imports.mapping.encodingLatin1') },
  ]
  const decimalOptions: SelectOption[] = [
    { value: '.', label: t('imports.mapping.decimalDot') },
    { value: ',', label: t('imports.mapping.decimalComma') },
  ]
  const dateOrderOptions: SelectOption[] = [
    { value: 'DMY', label: t('imports.mapping.dateOrderDmy') },
    { value: 'MDY', label: t('imports.mapping.dateOrderMdy') },
    { value: 'YMD', label: t('imports.mapping.dateOrderYmd') },
  ]
  const signKindOptions: SelectOption[] = [
    { value: 'signed_amount', label: t('imports.mapping.signSignedAmount') },
    { value: 'debit_credit', label: t('imports.mapping.signDebitCredit') },
    { value: 'amount_and_type', label: t('imports.mapping.signAmountAndType') },
  ]

  const previewRows = applyResult?.rows.slice(0, MAX_PREVIEW_ROWS) ?? []
  const truncated = (applyResult?.rows.length ?? 0) > MAX_PREVIEW_ROWS

  const canSave = !!applyResult && !applyError && !saveMut.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('imports.mapping.title', { source: sourceName })}
      maxWidth={960}
    >
      <div className="flex flex-col gap-5">
        {hasSavedMapping ? (
          <p className="m-0 rounded-sm border border-line-soft bg-surface-2 px-3 py-2 text-wm-sm text-fg-muted">
            {t('imports.mapping.editingSaved')}
          </p>
        ) : proposal ? (
          <p className="m-0 flex flex-wrap items-center gap-2 rounded-sm border border-line-soft bg-surface-2 px-3 py-2 text-wm-sm text-fg-muted">
            <Badge variant={confidenceBadgeVariant(proposal.overallConfidence)}>
              {t(`imports.mapping.confidenceBadge.${proposal.overallConfidence}`)}
            </Badge>
            {t('imports.mapping.detectedIntro')}
          </p>
        ) : proposeError ? (
          <p className="m-0 rounded-sm border border-line-soft bg-negative-soft px-3 py-2 text-wm-sm text-negative">
            {t('imports.mapping.detectFailed', { error: proposeError })}
          </p>
        ) : (
          <p className="m-0 text-wm-sm text-fg-muted">{t('imports.mapping.detecting')}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('imports.mapping.delimiter')} hint={renderGuessHint('delimiter')}>
            <Select
              value={mapping.delimiter}
              onChange={(v) => update('delimiter', v as CsvMapping['delimiter'])}
              options={delimiterOptions}
              ariaLabel={t('imports.mapping.delimiter')}
            />
          </Field>

          <Field label={t('imports.mapping.encoding')} hint={renderGuessHint('encoding')}>
            <Select
              value={mapping.encoding}
              onChange={(v) => update('encoding', v as CsvMapping['encoding'])}
              options={encodingOptions}
              ariaLabel={t('imports.mapping.encoding')}
            />
          </Field>

          <Field label={t('imports.mapping.hasHeaderLabel')} hint={renderGuessHint('hasHeader')}>
            <label className="flex items-center gap-2 py-2 text-wm-sm normal-case tracking-normal text-fg">
              <input
                type="checkbox"
                className="wm-check"
                checked={mapping.hasHeader}
                onChange={(e) => update('hasHeader', e.target.checked)}
              />
              {t('imports.mapping.hasHeaderCheckbox')}
            </label>
          </Field>

          <Field
            label={t('imports.mapping.decimalSeparator')}
            hint={renderGuessHint('decimalSeparator')}
          >
            <Select
              value={mapping.decimalSeparator}
              onChange={(v) => update('decimalSeparator', v as CsvMapping['decimalSeparator'])}
              options={decimalOptions}
              ariaLabel={t('imports.mapping.decimalSeparator')}
            />
          </Field>

          <Field label={t('imports.mapping.dateOrder')} hint={renderGuessHint('dateOrder')}>
            <Select
              value={mapping.dateOrder}
              onChange={(v) => update('dateOrder', v as CsvMapping['dateOrder'])}
              options={dateOrderOptions}
              ariaLabel={t('imports.mapping.dateOrder')}
            />
          </Field>

          <Field label={t('imports.mapping.dateColumn')} hint={renderGuessHint('dateColumn')}>
            <Select
              value={String(mapping.dateColumn)}
              onChange={(v) => update('dateColumn', Number(v))}
              options={columnOptions}
              placeholder={t('imports.mapping.pickColumn')}
              ariaLabel={t('imports.mapping.dateColumn')}
            />
          </Field>

          <Field
            label={t('imports.mapping.descriptionColumn')}
            hint={renderGuessHint('descriptionColumn')}
          >
            <Select
              value={String(mapping.descriptionColumn)}
              onChange={(v) => update('descriptionColumn', Number(v))}
              options={columnOptions}
              placeholder={t('imports.mapping.pickColumn')}
              ariaLabel={t('imports.mapping.descriptionColumn')}
            />
          </Field>

          <Field label={t('imports.mapping.signConvention')} hint={renderGuessHint('sign')}>
            <Select
              value={mapping.sign.kind}
              onChange={(v) => {
                markEdited('sign')
                setMapping((m) => ({
                  ...m,
                  sign: defaultSignForKind(
                    v as CsvMapping['sign']['kind'],
                    m.sign,
                    columnCount,
                  ),
                }))
              }}
              options={signKindOptions}
              ariaLabel={t('imports.mapping.signConvention')}
            />
          </Field>

          {mapping.sign.kind === 'signed_amount' ? (
            <Field label={t('imports.mapping.amountColumn')}>
              <Select
                value={String(mapping.sign.amountColumn)}
                onChange={(v) => {
                  markEdited('sign')
                  setMapping((m) => ({
                    ...m,
                    sign: { kind: 'signed_amount', amountColumn: Number(v) },
                  }))
                }}
                options={columnOptions}
                placeholder={t('imports.mapping.pickColumn')}
                ariaLabel={t('imports.mapping.amountColumn')}
              />
            </Field>
          ) : null}

          {mapping.sign.kind === 'debit_credit' ? (
            <>
              <Field label={t('imports.mapping.debitColumn')}>
                <Select
                  value={String(mapping.sign.debitColumn)}
                  onChange={(v) => {
                    markEdited('sign')
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'debit_credit'
                          ? { ...m.sign, debitColumn: Number(v) }
                          : m.sign,
                    }))
                  }}
                  options={columnOptions}
                  placeholder={t('imports.mapping.pickColumn')}
                  ariaLabel={t('imports.mapping.debitColumn')}
                />
              </Field>
              <Field label={t('imports.mapping.creditColumn')}>
                <Select
                  value={String(mapping.sign.creditColumn)}
                  onChange={(v) => {
                    markEdited('sign')
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'debit_credit'
                          ? { ...m.sign, creditColumn: Number(v) }
                          : m.sign,
                    }))
                  }}
                  options={columnOptions}
                  placeholder={t('imports.mapping.pickColumn')}
                  ariaLabel={t('imports.mapping.creditColumn')}
                />
              </Field>
            </>
          ) : null}

          {mapping.sign.kind === 'amount_and_type' ? (
            <>
              <Field label={t('imports.mapping.amountColumn')}>
                <Select
                  value={String(mapping.sign.amountColumn)}
                  onChange={(v) => {
                    markEdited('sign')
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'amount_and_type'
                          ? { ...m.sign, amountColumn: Number(v) }
                          : m.sign,
                    }))
                  }}
                  options={columnOptions}
                  placeholder={t('imports.mapping.pickColumn')}
                  ariaLabel={t('imports.mapping.amountColumn')}
                />
              </Field>
              <Field label={t('imports.mapping.typeColumn')}>
                <Select
                  value={String(mapping.sign.typeColumn)}
                  onChange={(v) => {
                    markEdited('sign')
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'amount_and_type'
                          ? { ...m.sign, typeColumn: Number(v) }
                          : m.sign,
                    }))
                  }}
                  options={columnOptions}
                  placeholder={t('imports.mapping.pickColumn')}
                  ariaLabel={t('imports.mapping.typeColumn')}
                />
              </Field>
              <Field label={t('imports.mapping.debitValues')}>
                <Input
                  value={mapping.sign.debitValues.join(', ')}
                  onChange={(e) => {
                    markEdited('sign')
                    const values = e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter((v) => v.length > 0)
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'amount_and_type'
                          ? { ...m.sign, debitValues: values }
                          : m.sign,
                    }))
                  }}
                />
              </Field>
              <Field label={t('imports.mapping.creditValues')}>
                <Input
                  value={mapping.sign.creditValues.join(', ')}
                  onChange={(e) => {
                    markEdited('sign')
                    const values = e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter((v) => v.length > 0)
                    setMapping((m) => ({
                      ...m,
                      sign:
                        m.sign.kind === 'amount_and_type'
                          ? { ...m.sign, creditValues: values }
                          : m.sign,
                    }))
                  }}
                />
              </Field>
            </>
          ) : null}
        </div>

        {rawPreviewRows.length > 0 ? (
          <div>
            <p className="mb-1.5 text-wm-xs uppercase tracking-label text-fg-muted">
              {t('imports.mapping.rawPreviewTitle')}
            </p>
            <div className="max-h-40 overflow-auto rounded-sm border border-line-soft">
              <table className="wm-table">
                <thead>
                  <tr>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <th key={i}>{t('imports.mapping.columnHeader', { index: i })}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawPreviewRows.map((row, i) => (
                    <tr key={i}>
                      {Array.from({ length: columnCount }, (_, c) => (
                        <td key={c} className="font-mono text-[0.7rem]">
                          {row[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {applyError ? (
          <p className="m-0 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-wm-sm text-negative">
            {t('imports.mapping.previewFailed', { error: applyError })}
          </p>
        ) : null}

        {applyResult && applyResult.warnings.length > 0 ? (
          <div>
            <p className="mb-1.5 text-wm-xs uppercase tracking-label text-fg-muted">
              {t('imports.mapping.warningsTitle', { count: applyResult.warnings.length })}
            </p>
            <ul className="m-0 flex max-h-40 list-none flex-col gap-2 overflow-auto pl-0 text-wm-sm">
              {applyResult.warnings.map((w, i) => {
                const kind = classifyCsvMappingWarning(w.code)
                return (
                  <li key={`${w.code}-${i}`} className="rounded-sm border border-line-soft bg-surface-2 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={kind === 'imported' ? 'positive' : 'warning'}>
                        {kind === 'imported'
                          ? t('imports.mapping.warningImported')
                          : t('imports.mapping.warningDropped')}
                      </Badge>
                      <span className="font-mono text-[0.7rem] text-fg-muted">{w.code}</span>
                    </div>
                    <div className="mt-1 text-fg">{w.message}</div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-wm-xs uppercase tracking-label text-fg-muted">
            {t('imports.mapping.parsedPreviewTitle', {
              count: applyResult?.rows.length ?? 0,
            })}
          </p>
          <div className="max-h-64 overflow-auto rounded-sm border border-line-soft">
            <table className="wm-table">
              <thead>
                <tr>
                  <th>{t('imports.colDate')}</th>
                  <th>{t('imports.colDescription')}</th>
                  <th className="text-right">{t('imports.colAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    <td className="wm-muted">{formatMediumDate(row.occurredAt, dfLocale)}</td>
                    <td className="wm-td--desc">{row.description}</td>
                    <td className="wm-td--num text-right font-semibold">
                      {formatSignedMoney(row.signedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {truncated ? (
            <p className="mt-1 text-wm-xs text-fg-muted">
              {t('imports.mapping.previewTruncated', { shown: MAX_PREVIEW_ROWS })}
            </p>
          ) : null}
        </div>

        {saveMut.isError ? (
          <p className="m-0 text-wm-sm text-negative">
            {t('imports.mapping.saveFailed', { error: errorMessage(saveMut.error) })}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
          <Button variant="ghost" onClick={onClose} disabled={saveMut.isPending}>
            {t('imports.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => saveMut.mutate()}
            disabled={!canSave}
          >
            {saveMut.isPending ? t('quickAdd.saving') : t('imports.mapping.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
