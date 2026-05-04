import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from './ui/button'
import { colors, fontSize, radius, spacing, tracking } from '../theme/tokens'

interface SaveAsRuleSheetProps {
  visible: boolean
  onClose: () => void
  defaultPattern: string
  categoryName: string
  saving?: boolean
  onSave: (pattern: string) => Promise<void>
}

/**
 * Bottom-sheet modal that turns an AI suggestion into a permanent
 * CategorizationRule for the user. Pattern is pre-filled from the
 * matched description but editable; the category is fixed.
 */
export function SaveAsRuleSheet({
  visible,
  onClose,
  defaultPattern,
  categoryName,
  saving = false,
  onSave,
}: SaveAsRuleSheetProps): JSX.Element {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState(defaultPattern)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setPattern(defaultPattern)
      setError(null)
    }
  }, [visible, defaultPattern])

  const handleSave = async (): Promise<void> => {
    const trimmed = pattern.trim()
    if (trimmed.length < 2) {
      setError(t('saveAsRule.tooShort'))
      return
    }
    setError(null)
    try {
      await onSave(trimmed)
      onClose()
    } catch {
      setError(t('saveAsRule.failed'))
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t('saveAsRule.title')}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.body_p}>
              {t('saveAsRule.body', { category: categoryName })}
            </Text>

            <Text style={styles.label}>{t('saveAsRule.patternLabel')}</Text>
            <TextInput
              value={pattern}
              onChangeText={setPattern}
              placeholder={t('saveAsRule.patternPlaceholder')}
              placeholderTextColor={colors.fgMuted}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              editable={!saving}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.footer}>
            <Button
              label={t('saveAsRule.cancel')}
              variant="subtle"
              onPress={onClose}
              disabled={saving}
            />
            <Button
              label={saving ? t('common.saving') : t('saveAsRule.confirm')}
              variant="primary"
              loading={saving}
              disabled={saving}
              onPress={() => void handleSave()}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

/** Same heuristic as the desktop helper. */
export function suggestPatternFromDescription(description: string): string {
  const tokens = description
    .toLowerCase()
    .replace(/[^a-z0-9 áéíóúãâêôõçü]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  return tokens[0] ?? description.toLowerCase().trim().slice(0, 24)
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
    fontWeight: '500',
    letterSpacing: tracking.base,
  },
  close: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  body_p: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.45,
  },
  label: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.fg,
    fontSize: fontSize.md,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
  },
})
