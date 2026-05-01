import { AxiosError } from 'axios'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
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

export function RegisterScreen({
  navigation,
}: AuthStackScreenProps<'Register'>): JSX.Element {
  const { t } = useTranslation()
  const { register } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await register({ username, email, password }, true)
    } catch (e) {
      setError(registerErrorMessage(e, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>{t('auth.createYourAccount')}</Text>
          <Text style={styles.brandSubtitle}>
            {t('auth.registerSubtitle')}
          </Text>
        </View>

        <View style={styles.form}>
          <Field label={t('auth.username')} hint={t('auth.usernameInvalid')}>
            <Input
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
            />
          </Field>

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
              autoComplete="new-password"
              textContentType="newPassword"
            />
          </Field>

          <Button
            label={loading ? t('common.pleaseWait') : t('auth.createAccount')}
            variant="primary"
            block
            loading={loading}
            disabled={!username || !email || !password || loading}
            onPress={handleSubmit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerLabel}>{t('auth.hasAccount')} </Text>
          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text style={styles.footerLink}>{t('auth.signIn')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function registerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const raw = (error.response?.data as { message?: string | string[] })
      ?.message
    if (Array.isArray(raw)) return raw.join(' ')
    if (typeof raw === 'string') return raw
  }
  if (error instanceof Error) return error.message
  return fallback
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  brand: {
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  brandTitle: {
    color: colors.fg,
    fontSize: fontSize.xl,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  brandSubtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  form: { gap: spacing.md },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    marginTop: spacing.xl,
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
