import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Category,
  CategoryType,
  Source,
  SourceType,
  TransactionKind,
} from '@wimm/shared'
import { apiClient } from '../lib/api-client'
import {
  buildCategoryOptionGroups,
  categoryDisplayName,
} from '../lib/category-label'
import { fromIsoDate, toIsoDate } from '../lib/dates'
import { cn } from '../lib/cn'
import { Modal } from './ui/modal'
import { Tabs } from './ui/tabs'
import { Select } from './ui/select'
import { DatePicker } from './ui/date-picker'
import { Button } from './ui/button'
import { Field } from './ui/field'
import { Input } from './ui/input'

interface QuickAddModalProps {
  open: boolean
  onClose: () => void
  initialTab?: QuickAddTab
}

export type QuickAddTab = 'transaction' | 'category' | 'source'

function nowAsTime(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const formCls = 'flex flex-col gap-3.5'
const rowCls = 'flex flex-wrap gap-3'

export function QuickAddModal({
  open,
  onClose,
  initialTab = 'transaction',
}: QuickAddModalProps): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<QuickAddTab>(initialTab)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('quickAdd.modalTitle')}
      maxWidth={620}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as QuickAddTab)} defaultValue={tab}>
        <Tabs.List ariaLabel={t('quickAdd.tabsAria')}>
          <Tabs.Trigger value="transaction">
            {t('quickAdd.tabTransaction')}
          </Tabs.Trigger>
          <Tabs.Trigger value="category">{t('quickAdd.tabCategory')}</Tabs.Trigger>
          <Tabs.Trigger value="source">{t('quickAdd.tabSource')}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Panel value="transaction">
          <TransactionForm onDone={onClose} />
        </Tabs.Panel>
        <Tabs.Panel value="category">
          <CategoryForm onDone={onClose} />
        </Tabs.Panel>
        <Tabs.Panel value="source">
          <SourceForm onDone={onClose} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}

function TransactionForm({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [time, setTime] = useState(() => nowAsTime())
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')

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

  const sourceOptions = useMemo(
    () => [
      { value: '', label: t('common.none') },
      ...sources.map((s) => ({ value: s.id, label: s.name })),
    ],
    [sources, t],
  )
  const { leadingOptions: categoryLeading, optionGroups: categoryGroups } = useMemo(
    () =>
      buildCategoryOptionGroups(categories, t, {
        filterType: kind,
        leadingLabel: t('common.none'),
      }),
    [categories, kind, t],
  )

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount)
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Invalid amount')
      const parsed = fromIsoDate(date)
      if (!parsed) throw new Error('Invalid date')
      const [h, m] = time.split(':').map((s) => Number.parseInt(s, 10) || 0)
      parsed.setHours(h, m, 0, 0)
      await apiClient.post('/transactions', {
        kind,
        amount: amt,
        description: description.trim(),
        occurredAt: parsed.toISOString(),
        sourceId: sourceId || undefined,
        categoryId: categoryId || undefined,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!description.trim()) return
    createMut.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={formCls}>
      <KindToggle value={kind} onChange={setKind} />

      <div className={rowCls}>
        <Field label={t('quickAdd.amount')} className="basis-[180px] grow">
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('quickAdd.placeholders.amount')}
            required
            autoFocus
            className="wm-num"
          />
        </Field>
        <Field label={t('quickAdd.description')} className="basis-[260px] grow-[2]">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder={t('quickAdd.placeholders.description')}
          />
        </Field>
      </div>

      <div className={rowCls}>
        <Field label={t('quickAdd.date')} className="basis-[200px] grow">
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label={t('quickAdd.time')} className="basis-[120px] grow-0">
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            className="wm-num"
          />
        </Field>
        <Field label={t('quickAdd.source')} className="basis-[180px] grow">
          <Select
            value={sourceId}
            onChange={setSourceId}
            options={sourceOptions}
            placeholder={t('common.none')}
            ariaLabel={t('quickAdd.source')}
          />
        </Field>
        <Field label={t('quickAdd.category')} className="basis-[180px] grow">
          <Select
            value={categoryId}
            onChange={setCategoryId}
            leadingOptions={categoryLeading}
            optionGroups={categoryGroups}
            placeholder={t('common.none')}
            ariaLabel={t('quickAdd.category')}
          />
        </Field>
      </div>

      <FooterRow>
        {createMut.isError ? (
          <span className="text-wm-xs text-negative">
            {t('quickAdd.couldNotSave')}
          </span>
        ) : (
          <span className="text-wm-xs text-fg-soft">
            {t('quickAdd.hintSaveShortcut')}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={createMut.isPending}
        >
          {createMut.isPending
            ? t('quickAdd.saving')
            : t('quickAdd.saveTransaction')}
        </Button>
      </FooterRow>
    </form>
  )
}

function CategoryForm({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<CategoryType>('EXPENSE')
  const [parentId, setParentId] = useState('')

  const { data: categoriesForParent = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const parentOptions = useMemo(() => {
    const tops = categoriesForParent
      .filter((c) => !c.parentId && c.type === type)
      .sort((a, b) =>
        categoryDisplayName(a, t).localeCompare(categoryDisplayName(b, t)),
      )
    return [
      { value: '', label: t('quickAdd.categoryParentNone') },
      ...tops.map((c) => ({
        value: c.id,
        label: categoryDisplayName(c, t),
      })),
    ]
  }, [categoriesForParent, type, t])

  useEffect(() => {
    const validParentIds = new Set(
      categoriesForParent
        .filter((c) => !c.parentId && c.type === type)
        .map((c) => c.id),
    )
    if (parentId && !validParentIds.has(parentId)) {
      setParentId('')
    }
  }, [categoriesForParent, type, parentId])

  const categoryTypeOptions = useMemo(
    () => [
      {
        value: 'EXPENSE',
        label: t('quickAdd.categoryType.EXPENSE'),
      },
      {
        value: 'INCOME',
        label: t('quickAdd.categoryType.INCOME'),
      },
    ],
    [t],
  )

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/categories', {
        name: name.trim(),
        type,
        ...(parentId.trim() ? { parentId: parentId.trim() } : {}),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={formCls}>
      <div className={rowCls}>
        <Field label={t('categoriesTab.name')} className="basis-[240px] grow-[2]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder={t('quickAdd.placeholders.categoryName')}
          />
        </Field>
        <Field label={t('categoriesTab.type')} className="basis-[160px] grow">
          <Select
            value={type}
            onChange={(v) => setType(v as CategoryType)}
            options={categoryTypeOptions}
            ariaLabel={t('quickAdd.selectCategoryTypeAria')}
          />
        </Field>
      </div>

      <Field
        label={t('quickAdd.categoryParent')}
        className="w-full"
        hint={t('quickAdd.categoryParentHint')}
      >
        <Select
          value={parentId}
          onChange={setParentId}
          options={parentOptions}
          ariaLabel={t('quickAdd.categoryParentAria')}
        />
      </Field>

      <FooterRow>
        {createMut.isError ? (
          <span className="text-wm-xs text-negative">
            {t('quickAdd.couldNotSave')}
          </span>
        ) : (
          <span className="text-wm-xs text-fg-soft">
            {t('quickAdd.hintCategories')}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? t('quickAdd.saving') : t('quickAdd.saveCategory')}
        </Button>
      </FooterRow>
    </form>
  )
}

function SourceForm({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<SourceType>('BANK_ACCOUNT')
  const [closingDay, setClosingDay] = useState('')
  const [dueDay, setDueDay] = useState('')

  useEffect(() => {
    if (type !== 'CREDIT_CARD') {
      setClosingDay('')
      setDueDay('')
    }
  }, [type])

  const sourceTypeOptions = useMemo(
    () =>
      (['BANK_ACCOUNT', 'CREDIT_CARD', 'CASH', 'MANUAL'] as const).map(
        (value) => ({
          value,
          label: t(`quickAdd.sourceType.${value}`),
        }),
      ),
    [t],
  )

  const createMut = useMutation({
    mutationFn: async () => {
      const payload: {
        name: string
        type: SourceType
        closingDay?: number
        dueDay?: number
      } = { name: name.trim(), type }
      if (type === 'CREDIT_CARD') {
        payload.closingDay = Number.parseInt(closingDay, 10)
        payload.dueDay = Number.parseInt(dueDay, 10)
      }
      await apiClient.post('/sources', payload)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sources'] })
      onDone()
    },
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    if (type === 'CREDIT_CARD') {
      const c = Number.parseInt(closingDay, 10)
      const d = Number.parseInt(dueDay, 10)
      if (
        Number.isNaN(c) ||
        Number.isNaN(d) ||
        c < 1 ||
        c > 31 ||
        d < 1 ||
        d > 31
      ) {
        return
      }
    }
    createMut.mutate()
  }

  const creditCardBillingInvalid =
    type === 'CREDIT_CARD' &&
    (() => {
      const c = Number.parseInt(closingDay, 10)
      const d = Number.parseInt(dueDay, 10)
      return (
        Number.isNaN(c) ||
        Number.isNaN(d) ||
        c < 1 ||
        c > 31 ||
        d < 1 ||
        d > 31
      )
    })()

  return (
    <form onSubmit={handleSubmit} className={formCls}>
      <div className={rowCls}>
        <Field label={t('sourcesTab.name')} className="basis-[240px] grow-[2]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder={t('quickAdd.placeholders.sourceName')}
          />
        </Field>
        <Field label={t('sourcesTab.type')} className="basis-[160px] grow">
          <Select
            value={type}
            onChange={(v) => setType(v as SourceType)}
            options={sourceTypeOptions}
            ariaLabel={t('quickAdd.selectSourceTypeAria')}
          />
        </Field>
      </div>

      {type === 'CREDIT_CARD' ? (
        <div className={rowCls}>
          <Field
            label={t('quickAdd.creditCardClosingDay')}
            hint={t('quickAdd.creditCardClosingDayHint')}
            className="basis-[140px] grow"
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              required
              value={closingDay}
              onChange={(e) => setClosingDay(e.target.value)}
              className="wm-num"
              aria-label={t('quickAdd.creditCardClosingDay')}
            />
          </Field>
          <Field
            label={t('quickAdd.creditCardDueDay')}
            hint={t('quickAdd.creditCardDueDayHint')}
            className="basis-[140px] grow"
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              required
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className="wm-num"
              aria-label={t('quickAdd.creditCardDueDay')}
            />
          </Field>
        </div>
      ) : null}

      <FooterRow>
        {createMut.isError ? (
          <span className="text-wm-xs text-negative">
            {t('quickAdd.couldNotSave')}
          </span>
        ) : (
          <span className="text-wm-xs text-fg-soft">
            {t('quickAdd.hintSources')}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={createMut.isPending || creditCardBillingInvalid}
        >
          {createMut.isPending ? t('quickAdd.saving') : t('quickAdd.saveSource')}
        </Button>
      </FooterRow>
    </form>
  )
}

function KindToggle({
  value,
  onChange,
}: {
  value: TransactionKind
  onChange: (v: TransactionKind) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('quickAdd.transactionKindAria')}
      className="inline-flex self-start rounded-md border border-line-soft bg-surface-2 p-1"
    >
      <KindOption
        label={t('quickAdd.expense')}
        active={value === 'EXPENSE'}
        tone="negative"
        onClick={() => onChange('EXPENSE')}
      />
      <KindOption
        label={t('quickAdd.income')}
        active={value === 'INCOME'}
        tone="positive"
        onClick={() => onChange('INCOME')}
      />
    </div>
  )
}

function KindOption({
  label,
  active,
  tone,
  onClick,
}: {
  label: string
  active: boolean
  tone: 'positive' | 'negative'
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-sm px-3.5 py-1.5 text-wm-sm transition-colors duration-wm-fast',
        active
          ? cn(
              'bg-surface-3 font-semibold',
              tone === 'negative' ? 'text-negative' : 'text-positive',
            )
          : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  )
}

function FooterRow({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
      {children}
    </div>
  )
}
