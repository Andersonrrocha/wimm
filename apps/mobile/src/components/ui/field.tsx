import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { colors, fontSize, tracking } from '../../theme/tokens'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

export function Field({ label, hint, error, children, style }: FieldProps): JSX.Element {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
  },
  hint: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.xs,
  },
})
