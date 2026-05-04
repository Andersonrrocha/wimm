import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Switch, Text, View } from 'react-native'
import type {
  AiCategorizationMode,
  AppLocale,
  ChartDateMode,
  UpdateUserMeRequest,
  User,
} from '@wimm/shared'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { Segmented } from '../../components/ui/segmented'
import { useAuth } from '../../context/auth-context'
import { applyLocale } from '../../i18n/config'
import { apiClient } from '../../lib/api-client'
import { colors, fontSize, spacing } from '../../theme/tokens'

type PatchBody = UpdateUserMeRequest

export function PreferencesScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const currentLocale: AppLocale = user?.preferredLocale ?? 'pt'
  const currentMode: ChartDateMode = user?.chartDateMode ?? 'BILLING_CYCLE'
  const aiMode: AiCategorizationMode = user?.aiCategorizationMode ?? 'OFF'

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

      <Field label={t('settings.aiTitle')} hint={t('settings.aiSubtitle')}>
        <Panel padding="sm">
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {t('settings.aiToggleLabel')}
            </Text>
            <Switch
              value={aiMode === 'ON'}
              onValueChange={(v) =>
                updateMut.mutate({ aiCategorizationMode: v ? 'ON' : 'OFF' })
              }
              trackColor={{ false: colors.surface3, true: colors.accent }}
              thumbColor={colors.fg}
            />
          </View>
        </Panel>
      </Field>

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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleLabel: {
    color: colors.fg,
    fontSize: fontSize.sm,
    flex: 1,
  },
  spacer: { height: spacing.xl },
})
