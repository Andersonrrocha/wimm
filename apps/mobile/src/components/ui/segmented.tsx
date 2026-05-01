import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fontSize, radius, tracking } from '../../theme/tokens'

export type SegmentedTone = 'neutral' | 'positive' | 'negative' | 'accent'

export interface SegmentedOption {
  value: string
  label: string
  /** Color applied to the label text when this option is active. */
  tone?: SegmentedTone
}

interface SegmentedProps {
  value: string
  options: SegmentedOption[]
  onChange: (value: string) => void
  block?: boolean
}

const toneColor: Record<SegmentedTone, string> = {
  neutral: colors.fg,
  positive: colors.positive,
  negative: colors.negative,
  accent: colors.accent,
}

export function Segmented({
  value,
  options,
  onChange,
  block = false,
}: SegmentedProps): JSX.Element {
  return (
    <View
      style={[styles.container, block ? styles.block : styles.fit]}
      role="group"
    >
      {options.map((opt) => {
        const active = opt.value === value
        const tone = opt.tone ?? 'neutral'
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.option,
              active && styles.optionActive,
              block && styles.optionBlock,
            ]}
          >
            <Text
              style={[
                styles.label,
                active && {
                  color: toneColor[tone],
                  fontWeight: '600',
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderColor: colors.lineSoft,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 4,
  },
  fit: { alignSelf: 'flex-start' },
  block: { alignSelf: 'stretch' },
  option: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.xs,
  },
  optionBlock: { flex: 1, alignItems: 'center' },
  optionActive: {
    backgroundColor: colors.surface3,
  },
  label: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    letterSpacing: tracking.base,
  },
})
