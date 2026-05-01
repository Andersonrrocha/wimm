import { DefaultTheme, type Theme } from '@react-navigation/native'
import { colors } from '../theme/tokens'

/**
 * React Navigation theme bound to WIMM tokens. Keeps headers, tab bars and
 * background surfaces consistent with the rest of the app.
 */
export const navTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bgRaised,
    text: colors.fg,
    border: colors.lineSoft,
    primary: colors.accent,
    notification: colors.accent,
  },
}
