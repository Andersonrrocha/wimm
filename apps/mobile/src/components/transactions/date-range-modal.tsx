import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import {
  dateFnsLocaleForLang,
  formatMediumDate,
  fromIsoDate,
  toIsoDate,
  type DateRange,
} from '../../lib/dates'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface DateRangeModalProps {
  visible: boolean
  onClose: () => void
  initial: DateRange
  onApply: (range: DateRange) => void
}

export function DateRangeModal({
  visible,
  onClose,
  initial,
  onApply,
}: DateRangeModalProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const [from, setFrom] = useState<Date>(
    () => fromIsoDate(initial.from) ?? new Date(),
  )
  const [to, setTo] = useState<Date>(
    () => fromIsoDate(initial.to) ?? new Date(),
  )
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)

  const onFromChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowFromPicker(false)
    if (selected) setFrom(selected)
  }
  const onToChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowToPicker(false)
    if (selected) setTo(selected)
  }

  const handleApply = (): void => {
    // Normalize so `from <= to` regardless of pick order.
    const a = from <= to ? from : to
    const b = from <= to ? to : from
    onApply({ from: toIsoDate(a), to: toIsoDate(b) })
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('common.dateRange')}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <Field label={t('common.from')}>
            <Pressable
              onPress={() => setShowFromPicker(true)}
              style={({ pressed }) => [
                styles.fieldButton,
                pressed && styles.fieldPressed,
              ]}
            >
              <Text style={styles.fieldValue}>
                {formatMediumDate(from, dfLocale)}
              </Text>
            </Pressable>
            {showFromPicker && (
              <DateTimePicker
                value={from}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onFromChange}
                themeVariant="dark"
              />
            )}
            {Platform.OS === 'ios' && showFromPicker ? (
              <Pressable
                onPress={() => setShowFromPicker(false)}
                style={styles.dismiss}
              >
                <Text style={styles.dismissLabel}>{t('common.close')}</Text>
              </Pressable>
            ) : null}
          </Field>

          <Field label={t('common.to')}>
            <Pressable
              onPress={() => setShowToPicker(true)}
              style={({ pressed }) => [
                styles.fieldButton,
                pressed && styles.fieldPressed,
              ]}
            >
              <Text style={styles.fieldValue}>
                {formatMediumDate(to, dfLocale)}
              </Text>
            </Pressable>
            {showToPicker && (
              <DateTimePicker
                value={to}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onToChange}
                themeVariant="dark"
              />
            )}
            {Platform.OS === 'ios' && showToPicker ? (
              <Pressable
                onPress={() => setShowToPicker(false)}
                style={styles.dismiss}
              >
                <Text style={styles.dismissLabel}>{t('common.close')}</Text>
              </Pressable>
            ) : null}
          </Field>

          <Button
            label={t('common.apply')}
            variant="primary"
            block
            onPress={handleApply}
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
    padding: spacing.lg,
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
})
