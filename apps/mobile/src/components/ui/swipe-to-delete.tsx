import { Trash2 } from 'lucide-react-native'
import { useRef, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { useTranslation } from 'react-i18next'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

interface SwipeToDeleteProps {
  children: ReactNode
  onDelete: () => void
}

/**
 * Wraps a row/card with a left-swipe gesture that reveals a Delete action.
 * Tapping Delete invokes the callback and closes the row. Long-press on the
 * underlying card stays as the redundant deletion path.
 */
export function SwipeToDelete({
  children,
  onDelete,
}: SwipeToDeleteProps): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<Swipeable>(null)

  const handleDelete = (): void => {
    ref.current?.close()
    onDelete()
  }

  return (
    <Swipeable
      ref={ref}
      friction={1.6}
      rightThreshold={48}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [
            styles.action,
            pressed && styles.actionPressed,
          ]}
        >
          <View style={styles.actionInner}>
            <Trash2 color={colors.accentInk} size={18} />
            <Text style={styles.label}>{t('common.delete')}</Text>
          </View>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: colors.negative,
    borderRadius: radius.md,
    marginLeft: spacing.sm,
    width: 84,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionInner: {
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: colors.accentInk,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
})
