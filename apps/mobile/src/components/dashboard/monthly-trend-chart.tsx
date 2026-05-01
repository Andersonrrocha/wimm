import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BarChart } from 'react-native-gifted-charts'
import type { MonthlyReportMonth } from '@wimm/shared'
import { formatMoney } from '../../lib/format-money'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

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
  // X-axis labels stay below the bars regardless of sign. Mixing positive
  // and negative values pushes labels onto the zero line and overlaps bars.
  // Tap a bar to toggle a value pill above it.
  const data = useMemo(
    () =>
      months.map((m, i) => {
        const net = parseAmount(m.net)
        const isSelected = selected === i
        const color = net >= 0 ? colors.positive : colors.negative
        return {
          value: Math.abs(net),
          label: m.label.slice(0, 3),
          frontColor: color,
          labelTextStyle: styles.barLabel,
          topLabelComponent: () =>
            isSelected ? <TooltipPill net={net} color={color} /> : null,
        }
      }),
    [months, selected],
  )

  const maxAbs = Math.max(...data.map((d) => d.value), 1)

  return (
    <View style={styles.container}>
      <BarChart
        data={data}
        height={140}
        barWidth={16}
        spacing={10}
        initialSpacing={10}
        roundedTop
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

function TooltipPill({
  net,
  color,
}: {
  net: number
  color: string
}): JSX.Element {
  const sign = net >= 0 ? '+' : '−'
  return (
    <View style={styles.tooltip}>
      <Text style={[styles.tooltipText, { color }]}>
        {sign}
        {formatMoney(Math.abs(net))}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  barLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  tooltip: {
    backgroundColor: colors.surface3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: 4,
    alignSelf: 'center',
  },
  tooltipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
})
