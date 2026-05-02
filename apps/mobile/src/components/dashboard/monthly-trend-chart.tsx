import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BarChart } from 'react-native-gifted-charts'
import type { MonthlyReportMonth } from '@wimm/shared'
import { formatMoney } from '../../lib/format-money'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface MonthlyTrendChartProps {
  months: MonthlyReportMonth[]
}

function parseAmount(value: string): number {
  const n = Number.parseFloat(value)
  return Number.isNaN(n) ? 0 : n
}

export function MonthlyTrendChart({
  months,
}: MonthlyTrendChartProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)

  // Render `|net|` as positive bars and encode the sign through color so the
  // X-axis labels stay below the bars regardless of sign. Tap a bar to show
  // its value pill in the dedicated slot above the chart (placing it on the
  // bar via gifted-charts' `topLabelComponent` clips text to barWidth).
  const data = useMemo(
    () =>
      months.map((m, i) => {
        const net = parseAmount(m.net)
        const color = net >= 0 ? colors.positive : colors.negative
        const isSelected = selected === i
        return {
          value: Math.abs(net),
          label: m.label.slice(0, 3),
          frontColor: color,
          opacity: selected !== null && !isSelected ? 0.45 : 1,
          labelTextStyle: styles.barLabel,
        }
      }),
    [months, selected],
  )

  const maxAbs = Math.max(...data.map((d) => d.value), 1)

  const selectedMonth = selected != null ? months[selected] : null
  const selectedNet = selectedMonth ? parseAmount(selectedMonth.net) : 0
  const selectedColor =
    selectedNet >= 0 ? colors.positive : colors.negative

  return (
    <View style={styles.container}>
      <View style={styles.tooltipSlot}>
        {selectedMonth ? (
          <View style={styles.tooltip}>
            <Text style={styles.tooltipMonth}>
              {selectedMonth.label}
            </Text>
            <Text style={styles.tooltipSep}>·</Text>
            <Text style={[styles.tooltipValue, { color: selectedColor }]}>
              {selectedNet >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(selectedNet))}
            </Text>
          </View>
        ) : null}
      </View>

      <BarChart
        data={data}
        height={140}
        barWidth={16}
        spacing={10}
        initialSpacing={10}
        roundedTop
        isAnimated
        animationDuration={500}
        hideRules
        hideYAxisText
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={colors.lineSoft}
        showVerticalLines={false}
        maxValue={maxAbs * 1.1}
        noOfSections={3}
        disableScroll
        onPress={(_item: unknown, index: number) =>
          setSelected((prev) => (prev === index ? null : index))
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  // Reserve a fixed slot so layout doesn't shift when the tooltip toggles.
  tooltipSlot: {
    height: 32,
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  tooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  tooltipMonth: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
  },
  tooltipSep: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
  },
  tooltipValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  barLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
})
