import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SourceType } from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { PickerModal, type PickerOption } from '../ui/picker-modal'
import { apiClient } from '../../lib/api-client'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface SourceFormProps {
  onDone: () => void
}

const SOURCE_TYPES: SourceType[] = [
  'BANK_ACCOUNT',
  'CREDIT_CARD',
  'CASH',
  'MANUAL',
]

export function SourceForm({ onDone }: SourceFormProps): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [type, setType] = useState<SourceType>('BANK_ACCOUNT')
  const [closingDay, setClosingDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [showTypePicker, setShowTypePicker] = useState(false)

  useEffect(() => {
    if (type !== 'CREDIT_CARD') {
      setClosingDay('')
      setDueDay('')
    }
  }, [type])

  const typeOptions: PickerOption[] = useMemo(
    () =>
      SOURCE_TYPES.map((value) => ({
        value,
        label: t(`quickAdd.sourceType.${value}`),
      })),
    [t],
  )

  const typeLabel = t(`quickAdd.sourceType.${type}`)

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

  const ccInvalid =
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

  const isValid = name.trim() !== '' && !ccInvalid

  return (
    <View style={styles.form}>
      <Field label={t('sourcesTab.name')}>
        <Input
          value={name}
          onChangeText={setName}
          placeholder={t('quickAdd.placeholders.sourceName')}
          autoFocus
        />
      </Field>

      <Field label={t('sourcesTab.type')}>
        <Pressable
          onPress={() => setShowTypePicker(true)}
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldPressed]}
        >
          <Text style={styles.fieldValue}>{typeLabel}</Text>
        </Pressable>
      </Field>

      {type === 'CREDIT_CARD' ? (
        <View style={styles.row}>
          <Field
            label={t('quickAdd.creditCardClosingDay')}
            hint={t('quickAdd.creditCardClosingDayHint')}
            style={styles.flex1}
          >
            <Input
              value={closingDay}
              onChangeText={setClosingDay}
              keyboardType="number-pad"
              maxLength={2}
            />
          </Field>
          <Field
            label={t('quickAdd.creditCardDueDay')}
            hint={t('quickAdd.creditCardDueDayHint')}
            style={styles.flex1}
          >
            <Input
              value={dueDay}
              onChangeText={setDueDay}
              keyboardType="number-pad"
              maxLength={2}
            />
          </Field>
        </View>
      ) : null}

      {createMut.isError ? (
        <Text style={styles.error}>{t('quickAdd.couldNotSave')}</Text>
      ) : null}

      <Button
        label={
          createMut.isPending
            ? t('quickAdd.saving')
            : t('quickAdd.saveSource')
        }
        variant="primary"
        block
        loading={createMut.isPending}
        disabled={!isValid || createMut.isPending}
        onPress={() => createMut.mutate()}
      />

      <PickerModal
        visible={showTypePicker}
        onClose={() => setShowTypePicker(false)}
        title={t('sourcesTab.type')}
        options={typeOptions}
        selected={type}
        onSelect={(v) => setType(v as SourceType)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
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
    letterSpacing: tracking.base,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
})
