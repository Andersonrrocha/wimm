import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Category,
  MaterializeRequest,
  MaterializeResponse,
  Recurrence,
  RecurrenceEndMode,
  RecurrenceFrequency,
  Source,
  TransactionKind,
} from '@wimm/shared'
import { addMonths } from 'date-fns'
import { apiClient } from '../lib/api-client'
import { categoryDisplayName } from '../lib/category-label'
import { PageHeader } from '../components/ui/page-header'
import { DatePicker } from '../components/ui/date-picker'
import { Select } from '../components/ui/select'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Panel } from '../components/ui/panel'
import { dateFnsLocaleForLang } from '../lib/date-fns-locale'
import { formatMediumDate, toIsoDate } from '../lib/dates'

function formatMoney(amount: string): string {
  const n = Number.parseFloat(amount)
  if (Number.isNaN(n)) return amount
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function defaultUntilDate(): string {
  return toIsoDate(addMonths(new Date(), 3))
}

export function RecurrencesPage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )
  const qc = useQueryClient()

  const kindOptions = useMemo(
    () => [
      { value: 'EXPENSE' as const, label: t('recurrences.kindExpense') },
      { value: 'INCOME' as const, label: t('recurrences.kindIncome') },
    ],
    [t],
  )
  const freqOptions = useMemo(
    () => [
      { value: 'WEEKLY' as const, label: t('recurrences.freqWeekly') },
      { value: 'MONTHLY' as const, label: t('recurrences.freqMonthly') },
      { value: 'YEARLY' as const, label: t('recurrences.freqYearly') },
    ],
    [t],
  )
  const endModeOptions = useMemo(
    () => [
      { value: 'INDEFINITE' as const, label: t('recurrences.endNever') },
      { value: 'UNTIL_DATE' as const, label: t('recurrences.endOnDate') },
    ],
    [t],
  )
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('MONTHLY')
  const [startDate, setStartDate] = useState(() => toIsoDate(new Date()))
  const [endMode, setEndMode] = useState<RecurrenceEndMode>('INDEFINITE')
  const [endDate, setEndDate] = useState('')
  const [until, setUntil] = useState(defaultUntilDate)
  const [materializeRecurrenceId, setMaterializeRecurrenceId] = useState('')

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

  const { data: recurrences = [], isLoading, error } = useQuery({
    queryKey: ['recurrences'],
    queryFn: async () => {
      const { data } = await apiClient.get<Recurrence[]>('/recurrences')
      return data
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount)
      if (Number.isNaN(amt) || amt < 0.01) {
        throw new Error(t('recurrences.invalidAmount'))
      }
      const body = {
        kind,
        amount: amt,
        description: description.trim(),
        frequency,
        startDate: `${startDate}T12:00:00.000Z`,
        endMode,
        ...(endMode === 'UNTIL_DATE'
          ? { endDate: `${endDate}T12:00:00.000Z` }
          : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(categoryId ? { categoryId } : {}),
      }
      const { data } = await apiClient.post<Recurrence>('/recurrences', body)
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
      setDescription('')
      setAmount('')
    },
  })

  const materializeMut = useMutation({
    mutationFn: async (payload: MaterializeRequest) => {
      const { data } = await apiClient.post<MaterializeResponse>(
        '/recurrences/materialize',
        payload,
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/recurrences/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const patchMut = useMutation({
    mutationFn: async (payload: { id: string; active: boolean }) => {
      const { data } = await apiClient.patch<Recurrence>(
        `/recurrences/${payload.id}`,
        { active: payload.active },
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const handleCreate = (e: FormEvent): void => {
    e.preventDefault()
    if (!description.trim()) return
    if (endMode === 'UNTIL_DATE' && !endDate) return
    createMut.mutate()
  }

  const handleMaterialize = (): void => {
    const body: MaterializeRequest = { until }
    if (materializeRecurrenceId) {
      body.recurrenceId = materializeRecurrenceId
    }
    materializeMut.mutate(body)
  }

  const sorted = useMemo(
    () => [...recurrences].sort((a, b) => a.description.localeCompare(b.description)),
    [recurrences],
  )

  const activeCount = sorted.filter((r) => r.active).length

  return (
    <div className="mx-auto flex max-w-container flex-col gap-6">
      <PageHeader
        eyebrow={t('recurrences.eyebrow')}
        title={t('recurrences.pageTitle')}
        subtitle={t('recurrences.pageSubtitle')}
      />

      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>{t('recurrences.generateTitle')}</Panel.Title>
            <Panel.Subtitle>
              {t('recurrences.generateSubtitle')}
            </Panel.Subtitle>
          </div>
        </Panel.Header>

        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('recurrences.until')} className="basis-[200px] grow">
            <DatePicker value={until} onChange={setUntil} />
          </Field>
          <Field
            label={t('recurrences.ruleScope')}
            className="basis-[260px] grow-[2]"
          >
            <Select
              value={materializeRecurrenceId}
              onChange={setMaterializeRecurrenceId}
              options={[
                { value: '', label: t('recurrences.allRules') },
                ...sorted.map((r) => ({
                  value: r.id,
                  label: `${r.description} (${r.frequency})`,
                })),
              ]}
              placeholder={t('recurrences.allRules')}
              ariaLabel={t('recurrences.scopeAria')}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              onClick={handleMaterialize}
              disabled={materializeMut.isPending}
            >
              {materializeMut.isPending
                ? t('recurrences.generating')
                : t('recurrences.generate')}
            </Button>
          </div>
        </div>

        {materializeMut.isSuccess && materializeMut.data && (
          <p className="text-wm-sm text-positive">
            {t('recurrences.materializeSuccess', {
              count: materializeMut.data.created,
            })}
          </p>
        )}
        {materializeMut.isError && (
          <p className="text-wm-sm text-negative">
            {t('recurrences.materializeError')}
          </p>
        )}
      </Panel>

      <Panel>
        <Panel.Header>
          <div>
            <Panel.Title>{t('recurrences.newRuleTitle')}</Panel.Title>
            <Panel.Subtitle>
              {t('recurrences.newRuleSubtitle')}
            </Panel.Subtitle>
          </div>
        </Panel.Header>

        <form
          onSubmit={handleCreate}
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
        >
          <Field label={t('recurrences.kind')}>
            <Select
              value={kind}
              onChange={(v) => setKind(v as TransactionKind)}
              options={kindOptions}
              ariaLabel={t('recurrences.kind')}
            />
          </Field>
          <Field label={t('recurrences.amount')}>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={t('quickAdd.placeholders.amount')}
              className="wm-num"
            />
          </Field>
          <Field label={t('recurrences.description')} className="col-span-2">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder={t('recurrences.descPlaceholder')}
            />
          </Field>
          <Field label={t('recurrences.frequency')}>
            <Select
              value={frequency}
              onChange={(v) => setFrequency(v as RecurrenceFrequency)}
              options={freqOptions}
              ariaLabel={t('recurrences.frequency')}
            />
          </Field>
          <Field label={t('recurrences.startDate')}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label={t('recurrences.ends')}>
            <Select
              value={endMode}
              onChange={(v) => setEndMode(v as RecurrenceEndMode)}
              options={endModeOptions}
              ariaLabel={t('recurrences.endModeAria')}
            />
          </Field>
          {endMode === 'UNTIL_DATE' && (
            <Field label={t('recurrences.endDate')}>
              <DatePicker value={endDate} onChange={setEndDate} />
            </Field>
          )}
          <Field label={t('recurrences.source')}>
            <Select
              value={sourceId}
              onChange={setSourceId}
              options={[
                { value: '', label: t('common.none') },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
              placeholder={t('common.none')}
              ariaLabel={t('recurrences.source')}
            />
          </Field>
          <Field label={t('recurrences.category')}>
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: '', label: t('common.none') },
                ...categories
                  .filter((c) => c.type === kind)
                  .map((c) => ({
                    value: c.id,
                    label: categoryDisplayName(c, t),
                  })),
              ]}
              placeholder={t('common.none')}
              ariaLabel={t('recurrences.category')}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              disabled={createMut.isPending}
            >
              {createMut.isPending
                ? t('quickAdd.saving')
                : t('recurrences.addRule')}
            </Button>
          </div>
        </form>

        {createMut.error && (
          <p className="text-wm-sm text-negative">
            {(createMut.error as Error).message ?? t('recurrences.createError')}
          </p>
        )}
      </Panel>

      <Panel flush className="overflow-hidden">
        <div className="px-[18px] pt-[18px]">
          <Panel.Title>{t('recurrences.rulesTitle')}</Panel.Title>
          <Panel.Subtitle>
            {sorted.length === 0
              ? t('recurrences.rulesEmptySubtitle')
              : t('recurrences.rulesSubtitle', {
                  total: sorted.length,
                  active: activeCount,
                })}
          </Panel.Subtitle>
        </div>

        <div className="px-[18px] pt-3.5">
          {error ? (
            <p className="text-wm-sm text-negative">
              {t('recurrences.loadError')}
            </p>
          ) : isLoading ? (
            <p className="text-wm-sm text-fg-muted">{t('common.loading')}</p>
          ) : sorted.length === 0 ? (
            <EmptyState>
              <span>{t('recurrences.emptyHint')}</span>
            </EmptyState>
          ) : (
            <div className="-mx-[18px] overflow-auto">
              <table className="wm-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>{t('recurrences.colActive')}</th>
                    <th>{t('recurrences.colDescription')}</th>
                    <th>{t('recurrences.colKind')}</th>
                    <th className="text-right">{t('recurrences.colAmount')}</th>
                    <th>{t('recurrences.colFrequency')}</th>
                    <th>{t('recurrences.colStart')}</th>
                    <th>{t('recurrences.colEnds')}</th>
                    <th className="wm-table__actions" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
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
                      <td>{r.description}</td>
                      <td>
                        <Badge
                          variant={r.kind === 'INCOME' ? 'positive' : 'negative'}
                        >
                          {r.kind === 'INCOME'
                            ? t('recurrences.kindIncome')
                            : t('recurrences.kindExpense')}
                        </Badge>
                      </td>
                      <td className="wm-td--num text-right font-semibold">
                        {formatMoney(r.amount)}
                      </td>
                      <td>
                        <Badge>
                          {r.frequency === 'WEEKLY'
                            ? t('recurrences.freqWeekly')
                            : r.frequency === 'MONTHLY'
                              ? t('recurrences.freqMonthly')
                              : t('recurrences.freqYearly')}
                        </Badge>
                      </td>
                      <td className="wm-muted">
                        {formatMediumDate(r.startDate, dfLocale)}
                      </td>
                      <td className="wm-muted">
                        {r.endMode === 'UNTIL_DATE' && r.endDate
                          ? formatMediumDate(r.endDate, dfLocale)
                          : '—'}
                      </td>
                      <td className="wm-table__actions">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(t('recurrences.deleteConfirm'))
                            ) {
                              deleteMut.mutate(r.id)
                            }
                          }}
                        >
                          {t('recurrences.delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
