import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

export type KpiTone = 'neutral' | 'positive' | 'negative' | 'accent'

interface KpiCardProps {
  label: string
  value: string
  hint?: string
  tone?: KpiTone
  /** Optional sign rendered before the value (e.g. "+" or "−"). */
  sign?: string
}

const valueColorByTone: Record<KpiTone, string> = {
  neutral: colors.fg,
  positive: colors.positive,
  negative: colors.negative,
  accent: colors.accent,
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
  sign = '',
}: KpiCardProps): JSX.Element {
  const valueColor = valueColorByTone[tone]
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>
        {sign}
        {value}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderColor: colors.lineSoft,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    minWidth: 0,
  },
  label: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
  },
  value: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  hint: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
})
