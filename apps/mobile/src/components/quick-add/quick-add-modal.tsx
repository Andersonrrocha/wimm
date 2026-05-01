import { useEffect, useState } from 'react'
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
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'
import { CategoryForm } from './category-form'
import { SourceForm } from './source-form'
import { TransactionForm } from './transaction-form'

export type QuickAddTab = 'transaction' | 'category' | 'source'

interface QuickAddModalProps {
  visible: boolean
  onClose: () => void
  initialTab?: QuickAddTab
}

const TABS: QuickAddTab[] = ['transaction', 'category', 'source']

export function QuickAddModal({
  visible,
  onClose,
  initialTab = 'transaction',
}: QuickAddModalProps): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<QuickAddTab>(initialTab)

  useEffect(() => {
    if (visible) setTab(initialTab)
  }, [visible, initialTab])

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
            <Text style={styles.title}>{t('quickAdd.modalTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <View style={styles.tabsRow}>
            {TABS.map((id) => (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                style={[styles.tab, tab === id && styles.tabActive]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    tab === id && styles.tabLabelActive,
                  ]}
                >
                  {t(tabLabelKey(id))}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'transaction' ? (
              <TransactionForm onDone={onClose} />
            ) : tab === 'category' ? (
              <CategoryForm onDone={onClose} />
            ) : (
              <SourceForm onDone={onClose} />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function tabLabelKey(id: QuickAddTab): string {
  switch (id) {
    case 'transaction':
      return 'quickAdd.tabTransaction'
    case 'category':
      return 'quickAdd.tabCategory'
    case 'source':
      return 'quickAdd.tabSource'
  }
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
  tabsRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface3,
  },
  tabLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.fg,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
})
