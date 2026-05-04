import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type {
  AiCategorizationMode,
  AppLocale,
  ChartDateMode,
  UpdateUserMeRequest,
  User,
} from '@wimm/shared'
import { Button } from '../../components/ui/button'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { Segmented } from '../../components/ui/segmented'
import { useAuth } from '../../context/auth-context'
import { applyLocale } from '../../i18n/config'
import { apiClient } from '../../lib/api-client'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

type PatchBody = UpdateUserMeRequest

export function PreferencesScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const currentLocale: AppLocale = user?.preferredLocale ?? 'pt'
  const currentMode: ChartDateMode = user?.chartDateMode ?? 'BILLING_CYCLE'
  const aiMode: AiCategorizationMode = user?.aiCategorizationMode ?? 'OFF'
  const hasAiKey = user?.hasAiApiKey ?? false
  const [byokInput, setByokInput] = useState('')
  const [byokError, setByokError] = useState<string | null>(null)

  const updateMut = useMutation({
    mutationFn: async (body: PatchBody) => {
      const { data } = await apiClient.patch<User>('/users/me', body)
      return data
    },
    onSuccess: async (data) => {
      await applyLocale(data.preferredLocale)
      await refreshUser()
    },
  })

  const onSaveByokKey = async (): Promise<void> => {
    setByokError(null)
    const trimmed = byokInput.trim()
    if (!trimmed.startsWith('sk-ant-')) {
      setByokError(t('settings.aiKeyInvalid'))
      return
    }
    try {
      await updateMut.mutateAsync({
        aiApiKey: trimmed,
        aiCategorizationMode: 'BYOK',
      })
      setByokInput('')
    } catch {
      setByokError(t('settings.aiKeyFailed'))
    }
  }

  const onClearByokKey = (): void => {
    updateMut.mutate({ aiApiKey: null })
  }

  return (
    <Screen scroll edges={[]}>
      <Field
        label={t('settings.language')}
        hint={t('settings.languageHint')}
      >
        <Panel padding="sm">
          <Segmented
            value={currentLocale}
            block
            onChange={(v) =>
              updateMut.mutate({ preferredLocale: v as AppLocale })
            }
            options={[
              { value: 'en', label: t('settings.localeEn') },
              { value: 'pt', label: t('settings.localePt') },
            ]}
          />
        </Panel>
      </Field>

      <Field
        label={t('settings.chartDateMode')}
        hint={t('settings.chartDateModeHint')}
      >
        <Panel padding="sm">
          <Segmented
            value={currentMode}
            block
            onChange={(v) =>
              updateMut.mutate({ chartDateMode: v as ChartDateMode })
            }
            options={[
              {
                value: 'BILLING_CYCLE',
                label: t('onboarding.modeBillingCycle'),
              },
              {
                value: 'PURCHASE_DATE',
                label: t('onboarding.modePurchaseDate'),
              },
            ]}
          />
        </Panel>
      </Field>

      <Text style={styles.sectionTitle}>{t('settings.aiTitle')}</Text>
      <Text style={styles.sectionSubtitle}>{t('settings.aiSubtitle')}</Text>

      <Field label={t('settings.aiMode')} hint={t('settings.aiModeHint')}>
        <Panel padding="sm">
          <Segmented
            value={aiMode}
            block
            onChange={(v) =>
              updateMut.mutate({
                aiCategorizationMode: v as AiCategorizationMode,
              })
            }
            options={[
              { value: 'OFF', label: t('settings.aiModeOff') },
              { value: 'SERVER', label: t('settings.aiModeServer') },
              { value: 'BYOK', label: t('settings.aiModeByok') },
            ]}
          />
        </Panel>
      </Field>

      {aiMode === 'BYOK' ? (
        <Field
          label={t('settings.aiKeyLabel')}
          hint={t('settings.aiKeyHint')}
        >
          <Panel padding="sm">
            {hasAiKey ? (
              <View style={styles.aiKeyRow}>
                <Text style={styles.aiKeyOk}>
                  {t('settings.aiKeyConfigured')}
                </Text>
                <Pressable onPress={onClearByokKey} hitSlop={8}>
                  <Text style={styles.aiKeyAction}>
                    {t('settings.aiKeyClear')}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.aiKeyEntry}>
                <TextInput
                  value={byokInput}
                  onChangeText={setByokInput}
                  placeholder="sk-ant-..."
                  placeholderTextColor={colors.fgMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={styles.aiKeyInput}
                />
                <Button
                  label={t('settings.aiKeySave')}
                  variant="primary"
                  onPress={() => void onSaveByokKey()}
                  disabled={byokInput.trim().length < 20 || updateMut.isPending}
                />
              </View>
            )}
            {byokError ? (
              <Text style={styles.error}>{byokError}</Text>
            ) : null}
          </Panel>
        </Field>
      ) : null}

      {updateMut.isError ? (
        <Text style={styles.error}>{t('quickAdd.couldNotSave')}</Text>
      ) : null}

      <View style={styles.spacer} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  },
  sectionTitle: {
    color: colors.fg,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginTop: spacing.xl,
  },
  sectionSubtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.45,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  aiKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiKeyOk: {
    color: colors.fg,
    fontSize: fontSize.sm,
  },
  aiKeyAction: {
    color: colors.accent,
    fontSize: fontSize.sm,
  },
  aiKeyEntry: {
    gap: spacing.sm,
  },
  aiKeyInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.fg,
    fontSize: fontSize.sm,
  },
  spacer: { height: spacing.xl },
})
