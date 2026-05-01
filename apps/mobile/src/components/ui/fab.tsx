import { Pressable, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius, shadow } from '../../theme/tokens'

interface FabProps {
  onPress: () => void
  /** Optional label for screen readers. */
  ariaLabel?: string
}

const TAB_BAR_HEIGHT = 50
const FAB_GAP = 14

export function Fab({ onPress, ariaLabel = 'Add' }: FabProps): JSX.Element {
  const insets = useSafeAreaInsets()
  const bottom = insets.bottom + TAB_BAR_HEIGHT + FAB_GAP

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        shadow.raised,
        { bottom },
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.icon}>+</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.accentHover,
    transform: [{ scale: 0.96 }],
  },
  icon: {
    color: colors.accentInk,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -2,
  },
})
