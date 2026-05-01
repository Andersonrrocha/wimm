import { useTranslation } from 'react-i18next'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

export interface PickerOption {
  value: string
  label: string
  hint?: string
}

interface PickerModalProps {
  visible: boolean
  onClose: () => void
  title: string
  options: PickerOption[]
  selected: string
  onSelect: (value: string) => void
}

export function PickerModal({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
}: PickerModalProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {options.map((opt) => {
            const isSelected = opt.value === selected
            return (
              <Pressable
                key={opt.value || '__none__'}
                onPress={() => {
                  onSelect(opt.value)
                  onClose()
                }}
                style={({ pressed }) => [
                  styles.item,
                  isSelected && styles.itemSelected,
                  pressed && styles.itemPressed,
                ]}
              >
                <View style={styles.itemBody}>
                  <Text
                    style={[
                      styles.itemLabel,
                      isSelected && styles.itemLabelSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {opt.hint ? (
                    <Text style={styles.itemHint}>{opt.hint}</Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Text style={styles.itemCheck}>✓</Text>
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.md,
  },
  itemSelected: {
    backgroundColor: colors.accentSoft,
  },
  itemPressed: {
    backgroundColor: colors.surface2,
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  itemLabel: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  itemLabelSelected: {
    color: colors.accent,
    fontWeight: '500',
  },
  itemHint: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  itemCheck: {
    color: colors.accent,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
})
