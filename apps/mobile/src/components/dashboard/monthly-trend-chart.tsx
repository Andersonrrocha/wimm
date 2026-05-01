import { StyleSheet, Text, View } from 'react-native'
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
  const data = months.map((m) => {
    const net = parseAmount(m.net)
    return {
      value: net,
      label: m.label.slice(0, 3),
      frontColor: net >= 0 ? colors.positive : colors.negative,
      labelTextStyle: styles.barLabel,
    }
  })

  const maxAbs = Math.max(
    ...data.map((d) => Math.abs(d.value)),
    1,
  )

  return (
    <View style={styles.container}>
      <BarChart
        data={data}
        height={140}
        barWidth={16}
        spacing={10}
        roundedTop
        roundedBottom
        hideRules
        hideYAxisText
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={colors.lineSoft}
        showVerticalLines={false}
        maxValue={maxAbs}
        mostNegativeValue={-maxAbs}
        noOfSections={2}
        disableScroll
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  barLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
})
