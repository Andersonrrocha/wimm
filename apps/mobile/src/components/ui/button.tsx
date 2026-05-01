import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { PressableProps, StyleProp, ViewStyle } from 'react-native'
import { colors, fontSize, radius } from '../../theme/tokens'

export type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  block?: boolean
  leftIcon?: ReactNode
  style?: StyleProp<ViewStyle>
}

export function Button({
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  block = false,
  leftIcon,
  disabled,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || loading
  const v = variants[variant]
  const s = sizes[size]

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { paddingVertical: s.py, paddingHorizontal: s.px, backgroundColor: v.bg, borderColor: v.border },
        block && styles.block,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <View style={styles.content}>
          {leftIcon}
          <Text style={[styles.label, { fontSize: s.fs, color: v.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

const variants: Record<ButtonVariant, { bg: string; border: string; fg: string }> = {
  primary: { bg: colors.accent, border: 'transparent', fg: colors.accentInk },
  ghost: { bg: colors.surface1, border: colors.line, fg: colors.fg },
  subtle: { bg: 'transparent', border: 'transparent', fg: colors.fgMuted },
  danger: { bg: 'transparent', border: 'rgba(255,160,160,0.45)', fg: '#ffb3b3' },
}

const sizes: Record<ButtonSize, { py: number; px: number; fs: number }> = {
  sm: { py: 6, px: 10, fs: fontSize.xs },
  md: { py: 10, px: 14, fs: fontSize.sm },
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontWeight: '500',
  },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
})
