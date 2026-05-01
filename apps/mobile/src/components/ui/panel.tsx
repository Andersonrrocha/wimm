import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { colors, radius, spacing } from '../../theme/tokens'

type Padding = 'sm' | 'md' | 'lg'

interface PanelProps {
  children: ReactNode
  padding?: Padding
  style?: StyleProp<ViewStyle>
}

const paddings: Record<Padding, number> = {
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.xl,
}

export function Panel({
  children,
  padding = 'md',
  style,
}: PanelProps): JSX.Element {
  return (
    <View style={[styles.container, { padding: paddings[padding] }, style]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface1,
    borderColor: colors.lineSoft,
    borderWidth: 1,
    borderRadius: radius.md,
  },
})
