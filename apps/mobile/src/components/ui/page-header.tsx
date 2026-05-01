import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, spacing, tracking } from '../../theme/tokens'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  trailing?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  trailing,
}: PageHeaderProps): JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.text}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
  },
  title: {
    color: colors.fg,
    fontSize: fontSize.xxl,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  trailing: {
    flexShrink: 0,
  },
})
