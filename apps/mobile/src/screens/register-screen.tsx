import { AxiosError } from 'axios'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../context/auth-context'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { colors, fontSize, spacing, tracking } from '../theme/tokens'
import type { AuthStackScreenProps } from '../navigation/auth-navigator'

const wimmLogo = require('../../assets/images/wimm-logo.png')

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
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={wimmLogo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={t('auth.brandAlt')}
          />

          <View style={styles.brand}>
            <Text style={styles.brandTitle}>
              {t('auth.createYourAccount')}
            </Text>
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
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerLabel}>{t('auth.hasAccount')} </Text>
          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text style={styles.footerLink}>{t('auth.signIn')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  fill: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logo: {
    width: 140,
    height: 40,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  brand: {
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
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
