import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, spacing } from '../../theme/tokens'

interface EmptyStateProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  title,
  subtitle,
  icon,
  action,
}: EmptyStateProps): JSX.Element {
  return (
    <View style={styles.container}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  icon: {
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.fg,
    fontSize: fontSize.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    maxWidth: 280,
  },
  action: {
    marginTop: spacing.md,
  },
})
