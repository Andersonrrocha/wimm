import { StyleSheet, View } from 'react-native'
import { BarChart } from 'react-native-gifted-charts'
import type { MonthlyReportMonth } from '@wimm/shared'
import { colors, fontSize, spacing } from '../../theme/tokens'

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
  // Render `|net|` as positive bars and encode the sign through color so the
  // X-axis labels stay below the bars regardless of whether a month closed
  // negative or positive. Mixing positive and negative bars in gifted-charts
  // pushes the labels onto the zero line and overlaps the bars.
  const data = months.map((m) => {
    const net = parseAmount(m.net)
    return {
      value: Math.abs(net),
      label: m.label.slice(0, 3),
      frontColor: net >= 0 ? colors.positive : colors.negative,
      labelTextStyle: styles.barLabel,
    }
  })

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
      />
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
})
