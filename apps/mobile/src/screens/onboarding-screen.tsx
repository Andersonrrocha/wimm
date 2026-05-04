import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ChartDateMode, User } from '@wimm/shared'
import { Button } from '../components/ui/button'
import { Segmented } from '../components/ui/segmented'
import { useAuth } from '../context/auth-context'
import { apiClient } from '../lib/api-client'
import {
  colors,
  fontSize,
  lineHeight,
  radius,
  spacing,
  tracking,
} from '../theme/tokens'

const STEPS = 3

/**
 * Three-step first-run flow shown when `user.onboardedAt === null`. Mirrors
 * the desktop OnboardingPage. The chart-mode selection on step 2 is held in
 * local state and committed atomically with the onboarded mark in `finish`.
 */
export function OnboardingScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const initial: ChartDateMode =
    state.status === 'authenticated'
      ? state.user.chartDateMode
      : 'BILLING_CYCLE'
  const [mode, setMode] = useState<ChartDateMode>(initial)
  const [step, setStep] = useState(0)

  const finishMut = useMutation({
    mutationFn: async () => {
      if (mode !== initial) {
        await apiClient.patch<User>('/users/me', { chartDateMode: mode })
      }
      await apiClient.post<User>('/users/me/onboarded')
    },
    onSuccess: async () => {
      await refreshUser()
    },
  })

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={styles.dots}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i <= step && styles.dotActive]}
            />
          ))}
        </View>

        {step === 0 && <WelcomeStep />}
        {step === 1 && <BillingCycleStep mode={mode} onChange={setMode} />}
        {step === 2 && <ReadyStep />}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 ? (
          <Button
            label={t('onboarding.back')}
            variant="subtle"
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            disabled={finishMut.isPending}
          />
        ) : (
          <View style={styles.spacer} />
        )}
        {step < STEPS - 1 ? (
          <Button
            label={t('onboarding.next')}
            variant="primary"
            onPress={() => setStep((s) => Math.min(STEPS - 1, s + 1))}
          />
        ) : (
          <Button
            label={
              finishMut.isPending
                ? t('common.saving')
                : t('onboarding.getStarted')
            }
            variant="primary"
            onPress={() => finishMut.mutate()}
            disabled={finishMut.isPending}
          />
        )}
      </View>
    </View>
  )
}

function WelcomeStep(): JSX.Element {
  const { t } = useTranslation()
  return (
    <View style={styles.stepCenter}>
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../assets/icon.png')}
        style={styles.brand}
        resizeMode="contain"
      />
      <Text style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
      <Text style={styles.body}>{t('onboarding.welcomeBody')}</Text>
    </View>
  )
}

function BillingCycleStep({
  mode,
  onChange,
}: {
  mode: ChartDateMode
  onChange: (next: ChartDateMode) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <View style={styles.stepLeft}>
      <Text style={styles.title}>{t('onboarding.billingTitle')}</Text>
      <Text style={styles.body}>{t('onboarding.billingBody')}</Text>

      <View style={styles.example}>
        <ExampleRow
          label={t('onboarding.billingExampleSpentLabel')}
          value="R$ 200 — May 5"
          highlight={false}
        />
        <ExampleRow
          label={t('onboarding.billingExampleOtherApps')}
          value="May"
          highlight={false}
        />
        <ExampleRow
          label={t('onboarding.billingExampleWimm')}
          value="June"
          highlight
        />
      </View>

      <Segmented
        value={mode}
        block
        options={[
          { value: 'BILLING_CYCLE', label: t('onboarding.modeBillingCycle') },
          { value: 'PURCHASE_DATE', label: t('onboarding.modePurchaseDate') },
        ]}
        onChange={(v) => onChange(v as ChartDateMode)}
      />
    </View>
  )
}

function ReadyStep(): JSX.Element {
  const { t } = useTranslation()
  return (
    <View style={styles.stepCenter}>
      <Text style={styles.title}>{t('onboarding.readyTitle')}</Text>
      <Text style={styles.body}>{t('onboarding.readyBody')}</Text>
    </View>
  )
}

function ExampleRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight: boolean
}): JSX.Element {
  return (
    <View style={styles.exampleRow}>
      <Text style={styles.exampleLabel}>{label}</Text>
      <Text style={[styles.exampleValue, highlight && styles.exampleValueHi]}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  dot: {
    width: 28,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  dotActive: { backgroundColor: colors.accent },
  stepCenter: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  stepLeft: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  brand: { width: 96, height: 64 },
  title: {
    color: colors.fg,
    fontSize: fontSize.xl,
    fontWeight: '500',
    textAlign: 'left',
    letterSpacing: tracking.base,
  },
  body: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  example: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exampleLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  exampleValue: {
    color: colors.fg,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  exampleValueHi: { color: colors.accent },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
    backgroundColor: colors.bgRaised,
  },
  spacer: { width: 1 },
})
