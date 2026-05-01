import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { colors, spacing } from '../theme/tokens'

interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  contentStyle?: StyleProp<ViewStyle>
  /**
   * Safe-area edges to apply. Default: `['top']` for tab root screens.
   * Sub-screens with a React Navigation header should pass `[]`.
   */
  edges?: Edge[]
}

export function Screen({
  children,
  scroll = false,
  contentStyle,
  edges = ['top'],
}: ScreenProps): JSX.Element {
  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={styles.safe}>
        <ScrollView contentContainerStyle={[styles.body, contentStyle]}>
          {children}
        </ScrollView>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      <View style={[styles.body, styles.fill, contentStyle]}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  fill: {
    flex: 1,
  },
})
