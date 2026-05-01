import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type {
  Category,
  Source,
  TransactionKind,
} from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { PickerModal, type PickerOption } from '../ui/picker-modal'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import {
  dateFnsLocaleForLang,
  formatMediumDate,
  formatTime,
} from '../../lib/dates'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface TransactionFormProps {
  onDone: () => void
}

export function TransactionForm({ onDone }: TransactionFormProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const qc = useQueryClient()

  const [kind, setKind] = useState<TransactionKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<Date>(() => new Date())
  const [sourceId, setSourceId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)

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

  const sourceOptions: PickerOption[] = useMemo(
    () => [
      { value: '', label: t('common.none') },
      ...sources.map((s) => ({ value: s.id, label: s.name })),
    ],
    [sources, t],
  )
  const categoryOptions: PickerOption[] = useMemo(() => {
    const sorted = categories
      .filter((c) => c.type === kind)
      .map((c) => ({ value: c.id, label: categoryDisplayName(c, t) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: '', label: t('common.none') }, ...sorted]
  }, [categories, kind, t])

  const sourceLabel = sourceId
    ? sources.find((s) => s.id === sourceId)?.name ?? t('common.none')
    : t('common.none')
  const categoryLabel = categoryId
    ? categoryDisplayName(
        categories.find((c) => c.id === categoryId) ?? {
          name: '',
          categoryKey: null,
        },
        t,
      ) || t('common.none')
    : t('common.none')

  const createMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount.replace(',', '.'))
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Invalid amount')
      await apiClient.post('/transactions', {
        kind,
        amount: amt,
        description: description.trim(),
        occurredAt: date.toISOString(),
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

  const onDateChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowDatePicker(false)
    if (selected) {
      setDate((prev) => {
        // Preserve time-of-day when only the calendar day changes.
        const next = new Date(selected)
        next.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
        return next
      })
    }
  }

  const onTimeChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowTimePicker(false)
    if (selected) {
      setDate((prev) => {
        const next = new Date(prev)
        next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
        return next
      })
    }
  }

  const isValid =
    description.trim() !== '' &&
    !Number.isNaN(Number.parseFloat(amount.replace(',', '.'))) &&
    Number.parseFloat(amount.replace(',', '.')) > 0

  return (
    <View style={styles.form}>
      <KindToggle value={kind} onChange={setKind} />

      <Field label={t('quickAdd.amount')}>
        <Input
          value={amount}
          onChangeText={setAmount}
          placeholder={t('quickAdd.placeholders.amount')}
          keyboardType="decimal-pad"
          autoFocus
        />
      </Field>

      <Field label={t('quickAdd.description')}>
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder={t('quickAdd.placeholders.description')}
        />
      </Field>

      <View style={styles.row}>
        <Field label={t('quickAdd.date')} style={styles.flex2}>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={({ pressed }) => [
              styles.fieldButton,
              pressed && styles.fieldPressed,
            ]}
          >
            <Text style={styles.fieldValue}>
              {formatMediumDate(date, dfLocale)}
            </Text>
          </Pressable>
        </Field>
        <Field label={t('quickAdd.time')} style={styles.flex1}>
          <Pressable
            onPress={() => setShowTimePicker(true)}
            style={({ pressed }) => [
              styles.fieldButton,
              pressed && styles.fieldPressed,
            ]}
          >
            <Text style={[styles.fieldValue, styles.fieldValueNum]}>
              {formatTime(date)}
            </Text>
          </Pressable>
        </Field>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onDateChange}
          themeVariant="dark"
        />
      )}
      {Platform.OS === 'ios' && showDatePicker ? (
        <Pressable
          onPress={() => setShowDatePicker(false)}
          style={styles.dismiss}
        >
          <Text style={styles.dismissLabel}>{t('common.close')}</Text>
        </Pressable>
      ) : null}

      {showTimePicker && (
        <DateTimePicker
          value={date}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimeChange}
          themeVariant="dark"
        />
      )}
      {Platform.OS === 'ios' && showTimePicker ? (
        <Pressable
          onPress={() => setShowTimePicker(false)}
          style={styles.dismiss}
        >
          <Text style={styles.dismissLabel}>{t('common.close')}</Text>
        </Pressable>
      ) : null}

      <Field label={t('quickAdd.source')}>
        <Pressable
          onPress={() => setShowSourcePicker(true)}
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldPressed]}
        >
          <Text style={styles.fieldValue}>{sourceLabel}</Text>
        </Pressable>
      </Field>

      <Field label={t('quickAdd.category')}>
        <Pressable
          onPress={() => setShowCategoryPicker(true)}
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldPressed]}
        >
          <Text style={styles.fieldValue}>{categoryLabel}</Text>
        </Pressable>
      </Field>

      {createMut.isError ? (
        <Text style={styles.error}>{t('quickAdd.couldNotSave')}</Text>
      ) : null}

      <Button
        label={
          createMut.isPending
            ? t('quickAdd.saving')
            : t('quickAdd.saveTransaction')
        }
        variant="primary"
        block
        loading={createMut.isPending}
        disabled={!isValid || createMut.isPending}
        onPress={() => createMut.mutate()}
      />

      <PickerModal
        visible={showSourcePicker}
        onClose={() => setShowSourcePicker(false)}
        title={t('quickAdd.source')}
        options={sourceOptions}
        selected={sourceId}
        onSelect={setSourceId}
      />
      <PickerModal
        visible={showCategoryPicker}
        onClose={() => setShowCategoryPicker(false)}
        title={t('quickAdd.category')}
        options={categoryOptions}
        selected={categoryId}
        onSelect={setCategoryId}
      />
    </View>
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
    <View style={styles.kindToggle}>
      <KindOption
        label={t('quickAdd.expense')}
        active={value === 'EXPENSE'}
        tone="negative"
        onPress={() => onChange('EXPENSE')}
      />
      <KindOption
        label={t('quickAdd.income')}
        active={value === 'INCOME'}
        tone="positive"
        onPress={() => onChange('INCOME')}
      />
    </View>
  )
}

function KindOption({
  label,
  active,
  tone,
  onPress,
}: {
  label: string
  active: boolean
  tone: 'positive' | 'negative'
  onPress: () => void
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.kindOption, active && styles.kindOptionActive]}
    >
      <Text
        style={[
          styles.kindLabel,
          active && {
            color: tone === 'negative' ? colors.negative : colors.positive,
            fontWeight: '600',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  fieldValueNum: { fontVariant: ['tabular-nums'] },
  fieldButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldPressed: {
    backgroundColor: colors.surface3,
  },
  fieldValue: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  dismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
  },
  dismissLabel: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  kindToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderColor: colors.lineSoft,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 4,
    alignSelf: 'flex-start',
  },
  kindOption: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xs,
  },
  kindOptionActive: {
    backgroundColor: colors.surface3,
  },
  kindLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    letterSpacing: tracking.base,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
})
