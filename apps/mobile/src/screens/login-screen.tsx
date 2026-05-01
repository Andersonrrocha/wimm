import { AxiosError } from 'axios'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useAuth } from '../context/auth-context'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Screen } from '../components/screen'
import { colors, fontSize, spacing, tracking } from '../theme/tokens'
import type { AuthStackScreenProps } from '../navigation/auth-navigator'

export function LoginScreen({
  navigation,
}: AuthStackScreenProps<'Login'>): JSX.Element {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await login({ email, password }, rememberMe)
    } catch (e) {
      setError(loginErrorMessage(e, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>WIMM</Text>
          <Text style={styles.brandSubtitle}>{t('auth.brandAlt')}</Text>
        </View>

        <View style={styles.form}>
          <Field label={t('auth.email')}>
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />
          </Field>

          <Field label={t('auth.password')}>
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          </Field>

          <Pressable
            style={styles.rememberRow}
            onPress={() => setRememberMe((v) => !v)}
          >
            <Switch
              value={rememberMe}
              onValueChange={setRememberMe}
              trackColor={{ false: colors.surface3, true: colors.accent }}
              thumbColor={colors.fg}
            />
            <Text style={styles.rememberLabel}>{t('auth.rememberMe')}</Text>
          </Pressable>

          <Button
            label={loading ? t('common.pleaseWait') : t('auth.signIn')}
            variant="primary"
            block
            loading={loading}
            disabled={!email || !password || loading}
            onPress={handleSubmit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerLabel}>{t('auth.noAccount')} </Text>
          <Pressable onPress={() => navigation.navigate('Register')}>
            <Text style={styles.footerLink}>{t('auth.createOne')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function loginErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string {
  if (error instanceof AxiosError && error.response?.status === 401) {
    const raw = (error.response.data as { message?: string | string[] })
      ?.message
    const code = Array.isArray(raw) ? raw[0] : raw
    if (code === 'USER_NOT_FOUND') return t('auth.noAccountForEmail')
  }
  return t('auth.invalidCredentials')
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  brand: {
    alignItems: 'flex-start',
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  brandTitle: {
    color: colors.fg,
    fontSize: fontSize.xxxl,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  form: { gap: spacing.md },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rememberLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  footerLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  footerLink: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '500',
    letterSpacing: tracking.base,
  },
})
