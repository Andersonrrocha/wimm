import { StyleSheet, Text, View } from 'react-native'
import { DonutChart } from './donut-chart'
import { formatMoney } from '../../lib/format-money'
import { colors, fontSize, spacing, tracking } from '../../theme/tokens'

const PALETTE = [
  colors.chart1,
  colors.chart2,
  colors.chart4,
  colors.chart5,
  colors.chart6,
  colors.chart3,
]

const SIZE = 176
const STROKE = 28

export interface CategorySlice {
  /** Stable id for `key` and de-duplication. */
  id: string
  label: string
  /** Pre-parsed numeric value (already in absolute units). */
  value: number
}

interface CategoryDonutProps {
  slices: CategorySlice[]
  /** Number to render at the center (usually the total expense). */
  centerValue: string
  /** Optional small label below the centerValue (e.g. "Total"). */
  centerLabel?: string
}

export function CategoryDonut({
  slices,
  centerValue,
  centerLabel,
}: CategoryDonutProps): JSX.Element {
  const data = slices.map((s, i) => ({
    id: s.id,
    value: s.value,
    color: PALETTE[i % PALETTE.length],
  }))

  return (
    <View style={styles.container}>
      <DonutChart
        slices={data}
        size={SIZE}
        strokeWidth={STROKE}
        centerComponent={
          <View style={styles.center}>
            {centerLabel ? (
              <Text style={styles.centerLabel}>{centerLabel}</Text>
            ) : null}
            <Text style={styles.centerValue} numberOfLines={1}>
              {centerValue}
            </Text>
          </View>
        }
      />

      <View style={styles.legend}>
        {slices.map((s, i) => (
          <View key={s.id} style={styles.legendRow}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: PALETTE[i % PALETTE.length] },
              ]}
            />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={styles.legendValue}>{formatMoney(s.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  center: {
    alignItems: 'center',
  },
  centerLabel: {
    color: colors.fgMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
  },
  centerValue: {
    color: colors.fg,
    fontSize: fontSize.lg,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  legend: {
    alignSelf: 'stretch',
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    color: colors.fg,
    fontSize: fontSize.sm,
  },
  legendValue: {
    color: colors.fg,
    fontSize: fontSize.sm,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
})
