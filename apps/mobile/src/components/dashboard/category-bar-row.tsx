import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

interface CategoryBarRowProps {
  label: string
  value: string
  /** Width as a fraction of the row's total bar — `0`–`1`. */
  fraction: number
  /** Bar color; defaults to accent. Use chart palette for variation. */
  color?: string
}

export function CategoryBarRow({
  label,
  value,
  fraction,
  color = colors.accent,
}: CategoryBarRowProps): JSX.Element {
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)))
  return (
    <View style={styles.row}>
      <View style={styles.headRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${pct}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    gap: 6,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    color: colors.fg,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  value: {
    color: colors.fg,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  track: {
    height: 6,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
})
