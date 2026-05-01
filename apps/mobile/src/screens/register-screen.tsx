import { AxiosError } from 'axios'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
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
import { AuthBrand } from '../components/auth/auth-brand'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import {
  getPasswordRuleStates,
  isValidUsername,
  passwordMeetsAllRules,
  type PasswordRuleState,
} from '../lib/password-rules'
import { colors, fontSize, radius, spacing, tracking } from '../theme/tokens'
import type { AuthStackScreenProps } from '../navigation/auth-navigator'

export function RegisterScreen({
  navigation,
}: AuthStackScreenProps<'Register'>): JSX.Element {
  const { t } = useTranslation()
  const { register } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showRules, setShowRules] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const passwordRules = useMemo(
    () => getPasswordRuleStates(password, t),
    [password, t],
  )
  const passwordOk = passwordMeetsAllRules(password, t)
  const usernameOk = isValidUsername(username)
  const usernameInvalidShown = username.length > 0 && !usernameOk

  const handleSubmit = async (): Promise<void> => {
    if (!usernameOk || !passwordOk) return
    setError(null)
    setLoading(true)
    try {
      await register(
        {
          username: username.trim().toLowerCase().replace(/\s+/g, ' '),
          email: email.trim().toLowerCase(),
          password,
        },
        true,
      )
    } catch (e) {
      setError(registerErrorMessage(e, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  const submitDisabled =
    loading || !email || !usernameOk || !passwordOk

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
          <View style={styles.center}>
            <AuthBrand size="sm" />

            <View style={styles.brand}>
              <Text style={styles.brandTitle}>
                {t('auth.createYourAccount')}
              </Text>
              <Text style={styles.brandSubtitle}>
                {t('auth.registerSubtitle')}
              </Text>
            </View>

            <View style={styles.form}>
              <Field
                label={t('auth.username')}
                error={
                  usernameInvalidShown ? t('auth.usernameInvalid') : undefined
                }
              >
                <Input
                  value={username}
                  onChangeText={setUsername}
                  placeholder="yourname"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  invalid={usernameInvalidShown}
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
                  onFocus={() => setShowRules(true)}
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
                {showRules || password.length > 0 ? (
                  <PasswordRulesList rules={passwordRules} />
                ) : null}
              </Field>

              <Button
                label={
                  loading ? t('common.pleaseWait') : t('auth.createAccount')
                }
                variant="primary"
                block
                loading={loading}
                disabled={submitDisabled}
                onPress={handleSubmit}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
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

function PasswordRulesList({
  rules,
}: {
  rules: PasswordRuleState[]
}): JSX.Element {
  return (
    <View style={styles.rules} accessibilityLiveRegion="polite">
      {rules.map((r) => (
        <View key={r.id} style={styles.ruleRow}>
          <View
            style={[
              styles.ruleDot,
              r.met ? styles.ruleDotMet : styles.ruleDotUnmet,
            ]}
          >
            <Text
              style={[
                styles.ruleDotMark,
                r.met ? styles.ruleDotMarkMet : styles.ruleDotMarkUnmet,
              ]}
            >
              {r.met ? '✓' : '○'}
            </Text>
          </View>
          <Text
            style={[
              styles.ruleLabel,
              r.met ? styles.ruleLabelMet : styles.ruleLabelUnmet,
            ]}
          >
            {r.label}
          </Text>
        </View>
      ))}
    </View>
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
    paddingVertical: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  brand: {
    alignItems: 'center',
  },
  brandTitle: {
    color: colors.fg,
    fontSize: fontSize.xl,
    fontWeight: '600',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  brandSubtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: 4,
    textAlign: 'center',
  },
  form: { gap: spacing.md },
  rules: {
    marginTop: spacing.sm,
    gap: 4,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ruleDot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleDotMet: {
    borderColor: colors.positive,
    backgroundColor: colors.positiveSoft,
  },
  ruleDotUnmet: {
    borderColor: colors.lineSoft,
  },
  ruleDotMark: {
    fontSize: 10,
    lineHeight: 12,
  },
  ruleDotMarkMet: {
    color: colors.positive,
  },
  ruleDotMarkUnmet: {
    color: colors.fgSoft,
  },
  ruleLabel: {
    fontSize: fontSize.xs,
  },
  ruleLabelMet: {
    color: colors.positive,
  },
  ruleLabelUnmet: {
    color: colors.fgMuted,
  },
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
