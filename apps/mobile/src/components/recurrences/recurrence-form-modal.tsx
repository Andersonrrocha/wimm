import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type {
  Category,
  Recurrence,
  RecurrenceEndMode,
  RecurrenceFrequency,
  Source,
  TransactionKind,
} from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { PickerModal, type PickerOption } from '../ui/picker-modal'
import { Segmented } from '../ui/segmented'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import {
  dateFnsLocaleForLang,
  formatMediumDate,
  parseFlexibleDate,
  toIsoDate,
} from '../../lib/dates'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface RecurrenceFormModalProps {
  visible: boolean
  onClose: () => void
  /** When provided, the form opens in edit mode pre-filled with these values. */
  initial: Recurrence | null
}

export function RecurrenceFormModal({
  visible,
  onClose,
  initial,
}: RecurrenceFormModalProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const qc = useQueryClient()
  const isEdit = initial !== null

  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? 'EXPENSE')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    initial?.frequency ?? 'MONTHLY',
  )
  const [startDate, setStartDate] = useState<Date>(
    () => parseFlexibleDate(initial?.startDate ?? '') ?? new Date(),
  )
  const [endMode, setEndMode] = useState<RecurrenceEndMode>(
    initial?.endMode ?? 'INDEFINITE',
  )
  const [endDate, setEndDate] = useState<Date>(
    () =>
      parseFlexibleDate(initial?.endDate ?? '') ??
      new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1),
  )
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [showStartPicker, setShowStartPicker] = useState(false)
  const [showEndPicker, setShowEndPicker] = useState(false)
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

  const submitMut = useMutation({
    mutationFn: async () => {
      const amt = Number.parseFloat(amount.replace(',', '.'))
      if (Number.isNaN(amt) || amt <= 0) {
        throw new Error('INVALID_AMOUNT')
      }
      const payload: {
        kind: TransactionKind
        amount: number
        description: string
        frequency: RecurrenceFrequency
        startDate: string
        endMode: RecurrenceEndMode
        endDate?: string
        sourceId?: string | null
        categoryId?: string | null
      } = {
        kind,
        amount: amt,
        description: description.trim(),
        frequency,
        startDate: toIsoDate(startDate),
        endMode,
        sourceId: sourceId || null,
        categoryId: categoryId || null,
      }
      if (endMode === 'UNTIL_DATE') {
        payload.endDate = toIsoDate(endDate)
      }
      if (isEdit && initial) {
        await apiClient.patch(`/recurrences/${initial.id}`, payload)
      } else {
        await apiClient.post('/recurrences', payload)
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
      onClose()
    },
  })

  const onStartChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowStartPicker(false)
    if (selected) setStartDate(selected)
  }
  const onEndChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowEndPicker(false)
    if (selected) setEndDate(selected)
  }

  const isValid =
    description.trim() !== '' &&
    !Number.isNaN(Number.parseFloat(amount.replace(',', '.'))) &&
    Number.parseFloat(amount.replace(',', '.')) > 0

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Text style={styles.title}>
              {isEdit
                ? t('recurrences.pageTitle')
                : t('recurrences.newRuleTitle')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Field label={t('recurrences.kind')}>
              <Segmented
                value={kind}
                onChange={(v) => setKind(v as TransactionKind)}
                options={[
                  {
                    value: 'EXPENSE',
                    label: t('recurrences.kindExpense'),
                    tone: 'negative',
                  },
                  {
                    value: 'INCOME',
                    label: t('recurrences.kindIncome'),
                    tone: 'positive',
                  },
                ]}
              />
            </Field>

            <Field label={t('recurrences.amount')}>
              <Input
                value={amount}
                onChangeText={setAmount}
                placeholder="0,00"
                keyboardType="decimal-pad"
              />
            </Field>

            <Field label={t('recurrences.description')}>
              <Input
                value={description}
                onChangeText={setDescription}
                placeholder={t('recurrences.descPlaceholder')}
              />
            </Field>

            <Field label={t('recurrences.frequency')}>
              <Segmented
                value={frequency}
                onChange={(v) => setFrequency(v as RecurrenceFrequency)}
                block
                options={[
                  {
                    value: 'WEEKLY',
                    label: t('recurrences.freqWeekly'),
                  },
                  {
                    value: 'MONTHLY',
                    label: t('recurrences.freqMonthly'),
                  },
                  {
                    value: 'YEARLY',
                    label: t('recurrences.freqYearly'),
                  },
                ]}
              />
            </Field>

            <Field label={t('recurrences.startDate')}>
              <Pressable
                onPress={() => setShowStartPicker(true)}
                style={({ pressed }) => [
                  styles.fieldButton,
                  pressed && styles.fieldPressed,
                ]}
              >
                <Text style={styles.fieldValue}>
                  {formatMediumDate(startDate, dfLocale)}
                </Text>
              </Pressable>
              {showStartPicker && (
                <DateTimePicker
                  value={startDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={onStartChange}
                  themeVariant="dark"
                />
              )}
              {Platform.OS === 'ios' && showStartPicker ? (
                <Pressable
                  onPress={() => setShowStartPicker(false)}
                  style={styles.dismiss}
                >
                  <Text style={styles.dismissLabel}>{t('common.close')}</Text>
                </Pressable>
              ) : null}
            </Field>

            <Field label={t('recurrences.ends')}>
              <Segmented
                value={endMode}
                onChange={(v) => setEndMode(v as RecurrenceEndMode)}
                options={[
                  {
                    value: 'INDEFINITE',
                    label: t('recurrences.endNever'),
                  },
                  {
                    value: 'UNTIL_DATE',
                    label: t('recurrences.endOnDate'),
                  },
                ]}
              />
            </Field>

            {endMode === 'UNTIL_DATE' ? (
              <Field label={t('recurrences.endDate')}>
                <Pressable
                  onPress={() => setShowEndPicker(true)}
                  style={({ pressed }) => [
                    styles.fieldButton,
                    pressed && styles.fieldPressed,
                  ]}
                >
                  <Text style={styles.fieldValue}>
                    {formatMediumDate(endDate, dfLocale)}
                  </Text>
                </Pressable>
                {showEndPicker && (
                  <DateTimePicker
                    value={endDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onEndChange}
                    themeVariant="dark"
                  />
                )}
                {Platform.OS === 'ios' && showEndPicker ? (
                  <Pressable
                    onPress={() => setShowEndPicker(false)}
                    style={styles.dismiss}
                  >
                    <Text style={styles.dismissLabel}>
                      {t('common.close')}
                    </Text>
                  </Pressable>
                ) : null}
              </Field>
            ) : null}

            <Field label={t('recurrences.source')}>
              <Pressable
                onPress={() => setShowSourcePicker(true)}
                style={({ pressed }) => [
                  styles.fieldButton,
                  pressed && styles.fieldPressed,
                ]}
              >
                <Text style={styles.fieldValue}>{sourceLabel}</Text>
              </Pressable>
            </Field>

            <Field label={t('recurrences.category')}>
              <Pressable
                onPress={() => setShowCategoryPicker(true)}
                style={({ pressed }) => [
                  styles.fieldButton,
                  pressed && styles.fieldPressed,
                ]}
              >
                <Text style={styles.fieldValue}>{categoryLabel}</Text>
              </Pressable>
            </Field>

            {submitMut.isError ? (
              <Text style={styles.error}>{t('recurrences.createError')}</Text>
            ) : null}

            <Button
              label={
                submitMut.isPending
                  ? t('common.pleaseWait')
                  : t('recurrences.addRule')
              }
              variant="primary"
              block
              loading={submitMut.isPending}
              disabled={!isValid || submitMut.isPending}
              onPress={() => submitMut.mutate()}
            />
          </ScrollView>

          <PickerModal
            visible={showSourcePicker}
            onClose={() => setShowSourcePicker(false)}
            title={t('recurrences.source')}
            options={sourceOptions}
            selected={sourceId}
            onSelect={setSourceId}
          />
          <PickerModal
            visible={showCategoryPicker}
            onClose={() => setShowCategoryPicker(false)}
            title={t('recurrences.category')}
            options={categoryOptions}
            selected={categoryId}
            onSelect={setCategoryId}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.lineSoft,
    borderBottomWidth: 1,
  },
  title: {
    color: colors.fg,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  close: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '500',
    letterSpacing: tracking.base,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  fieldButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldPressed: { backgroundColor: colors.surface3 },
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
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
})
