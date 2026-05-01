import { useState } from 'react'
import { StyleSheet, TextInput } from 'react-native'
import type { TextInputProps } from 'react-native'
import { colors, fontSize, radius } from '../../theme/tokens'

interface InputProps extends TextInputProps {
  invalid?: boolean
}

export function Input({
  invalid = false,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps): JSX.Element {
  const [focused, setFocused] = useState(false)

  return (
    <TextInput
      {...rest}
      placeholderTextColor={colors.fgMuted}
      selectionColor={colors.accent}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={[
        styles.input,
        focused && styles.focused,
        invalid && styles.invalid,
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.fg,
    fontSize: fontSize.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  focused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface3,
  },
  invalid: {
    borderColor: colors.negative,
  },
})
