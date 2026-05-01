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
  CategorizationMatchType,
  CategorizationRule,
  Category,
} from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { PickerModal, type PickerOption } from '../ui/picker-modal'
import { Segmented } from '../ui/segmented'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface RuleFormModalProps {
  visible: boolean
  onClose: () => void
}

export function RuleFormModal({
  visible,
  onClose,
}: RuleFormModalProps): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: rules = [] } = useQuery({
    queryKey: ['categorization-rules'],
    queryFn: async () => {
      const { data } = await apiClient.get<CategorizationRule[]>(
        '/categorization-rules',
      )
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

  const nextPriority = useMemo(() => {
    if (rules.length === 0) return 100
    return Math.max(...rules.map((r) => r.priority)) + 10
  }, [rules])

  const [priority, setPriority] = useState(String(nextPriority))
  const [matchType, setMatchType] =
    useState<CategorizationMatchType>('CONTAINS')
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)

  // Reset form whenever the modal opens. Done in render via useMemo
  // because we want a fresh state without running on close → cleanup churn.
  useMemo(() => {
    if (visible) {
      setPriority(String(nextPriority))
      setMatchType('CONTAINS')
      setPattern('')
      setCategoryId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const categoryOptions: PickerOption[] = useMemo(() => {
    return categories
      .map((c) => ({
        value: c.id,
        label: categoryDisplayName(c, t),
        hint: c.type === 'INCOME' ? '+' : '−',
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [categories, t])

  const categoryLabel = categoryId
    ? categoryDisplayName(
        categories.find((c) => c.id === categoryId) ?? {
          name: '',
          categoryKey: null,
        },
        t,
      ) || t('rulesTab.selectPlaceholder')
    : t('rulesTab.selectPlaceholder')

  const submitMut = useMutation({
    mutationFn: async () => {
      const p = Number.parseInt(priority, 10)
      if (Number.isNaN(p) || p < 0) throw new Error('INVALID_PRIORITY')
      await apiClient.post('/categorization-rules', {
        priority: p,
        matchType,
        pattern: pattern.trim(),
        categoryId,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categorization-rules'] })
      onClose()
    },
  })

  const isValid =
    pattern.trim() !== '' &&
    categoryId !== '' &&
    !Number.isNaN(Number.parseInt(priority, 10)) &&
    Number.parseInt(priority, 10) >= 0

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
            <Text style={styles.title}>{t('rulesTab.newRuleTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle}>
              {t('rulesTab.newRuleSubtitle')}
            </Text>

            <View style={styles.row}>
              <Field label={t('rulesTab.priority')} style={styles.flex1}>
                <Input
                  value={priority}
                  onChangeText={setPriority}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </Field>
              <Field label={t('rulesTab.match')} style={styles.flex2}>
                <Segmented
                  value={matchType}
                  onChange={(v) =>
                    setMatchType(v as CategorizationMatchType)
                  }
                  block
                  options={[
                    {
                      value: 'CONTAINS',
                      label: t('rulesTab.matchContains'),
                    },
                    {
                      value: 'EQUALS',
                      label: t('rulesTab.matchEquals'),
                    },
                  ]}
                />
              </Field>
            </View>

            <Field label={t('rulesTab.pattern')}>
              <Input
                value={pattern}
                onChangeText={setPattern}
                placeholder={t('rulesTab.patternPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            </Field>

            <Field label={t('rulesTab.category')}>
              <Pressable
                onPress={() => setShowCategoryPicker(true)}
                style={({ pressed }) => [
                  styles.fieldButton,
                  pressed && styles.fieldPressed,
                ]}
              >
                <Text
                  style={[
                    styles.fieldValue,
                    !categoryId && styles.fieldValuePlaceholder,
                  ]}
                >
                  {categoryLabel}
                </Text>
              </Pressable>
            </Field>

            {submitMut.isError ? (
              <Text style={styles.error}>{t('rulesTab.createFailed')}</Text>
            ) : null}

            <Button
              label={
                submitMut.isPending
                  ? t('rulesTab.saving')
                  : t('rulesTab.addRule')
              }
              variant="primary"
              block
              loading={submitMut.isPending}
              disabled={!isValid || submitMut.isPending}
              onPress={() => submitMut.mutate()}
            />
          </ScrollView>

          <PickerModal
            visible={showCategoryPicker}
            onClose={() => setShowCategoryPicker(false)}
            title={t('rulesTab.category')}
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
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
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
  fieldValuePlaceholder: {
    color: colors.fgMuted,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
})
