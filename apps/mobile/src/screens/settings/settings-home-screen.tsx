import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../../components/ui/button'
import { Chip } from '../../components/ui/chip'
import { PageHeader } from '../../components/ui/page-header'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { useAuth } from '../../context/auth-context'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'
import type { SettingsStackScreenProps } from '../../navigation/settings-navigator'

interface SectionRowProps {
  label: string
  value?: string
  onPress: () => void
}

function SectionRow({ label, value, onPress }: SectionRowProps): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  )
}

export function SettingsHomeScreen({
  navigation,
}: SettingsStackScreenProps<'SettingsHome'>): JSX.Element {
  const { t } = useTranslation()
  const { state, logout } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null

  return (
    <Screen scroll>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('nav.settings')}
      />

      {user ? (
        <Panel>
          <Chip label={`@${user.username}`} tone="accent" />
          <Text style={styles.email}>{user.email}</Text>
        </Panel>
      ) : null}

      <Text style={styles.sectionLabel}>{t('settings.eyebrow')}</Text>
      <Panel padding="sm">
        <SectionRow
          label={t('settings.tabCategories')}
          onPress={() => navigation.navigate('Categories')}
        />
        <View style={styles.separator} />
        <SectionRow
          label={t('settings.tabSources')}
          onPress={() => navigation.navigate('Sources')}
        />
        <View style={styles.separator} />
        <SectionRow
          label={t('settings.tabRules')}
          onPress={() => navigation.navigate('Rules')}
        />
      </Panel>

      <Text style={styles.sectionLabel}>
        {t('settings.tabPreferences')}
      </Text>
      <Panel padding="sm">
        <SectionRow
          label={t('settings.language')}
          value={
            user?.preferredLocale === 'en'
              ? t('settings.localeEn')
              : t('settings.localePt')
          }
          onPress={() => navigation.navigate('Preferences')}
        />
      </Panel>

      <View style={styles.signOut}>
        <Button
          label={t('layout.signOut')}
          variant="danger"
          onPress={() => void logout()}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  email: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  sectionLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowPressed: {
    backgroundColor: colors.surface2,
  },
  rowLabel: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowValue: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  chevron: {
    color: colors.fgMuted,
    fontSize: fontSize.lg,
    lineHeight: fontSize.lg,
  },
  separator: {
    height: 1,
    backgroundColor: colors.lineSoft,
    marginHorizontal: spacing.sm,
  },
  signOut: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
})
