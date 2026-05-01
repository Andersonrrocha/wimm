import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import type { AppLocale, User } from '@wimm/shared'
import { Field } from '../../components/ui/field'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { Segmented } from '../../components/ui/segmented'
import { useAuth } from '../../context/auth-context'
import { applyLocale } from '../../i18n/config'
import { apiClient } from '../../lib/api-client'
import { colors, fontSize, spacing } from '../../theme/tokens'

export function PreferencesScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state, refreshUser } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const currentLocale: AppLocale = user?.preferredLocale ?? 'pt'

  const updateMut = useMutation({
    mutationFn: async (locale: AppLocale) => {
      const { data } = await apiClient.patch<User>('/users/me', {
        preferredLocale: locale,
      })
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
            onChange={(v) => updateMut.mutate(v as AppLocale)}
            options={[
              { value: 'en', label: t('settings.localeEn') },
              { value: 'pt', label: t('settings.localePt') },
            ]}
          />
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
  spacer: { height: spacing.xl },
})
