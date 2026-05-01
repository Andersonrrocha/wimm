import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, radius } from '../../theme/tokens'

export type ChipTone =
  | 'neutral'
  | 'positive'
  | 'negative'
  | 'info'
  | 'warning'
  | 'accent'

interface ChipProps {
  label: string
  tone?: ChipTone
}

const tones: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surface2, fg: colors.fgMuted },
  positive: { bg: colors.positiveSoft, fg: colors.positive },
  negative: { bg: colors.negativeSoft, fg: colors.negative },
  info: { bg: colors.infoSoft, fg: colors.info },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  accent: { bg: colors.accentSoft, fg: colors.accent },
}

export function Chip({ label, tone = 'neutral' }: ChipProps): JSX.Element {
  const t = tones[tone]
  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
})
