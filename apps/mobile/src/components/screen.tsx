import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing } from '../theme/tokens'

interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  contentStyle?: StyleProp<ViewStyle>
}

export function Screen({
  children,
  scroll = false,
  contentStyle,
}: ScreenProps): JSX.Element {
  if (scroll) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView contentContainerStyle={[styles.body, contentStyle]}>
          {children}
        </ScrollView>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
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
