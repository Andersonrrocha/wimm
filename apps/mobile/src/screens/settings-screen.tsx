import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../context/auth-context'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Panel } from '../components/ui/panel'
import { Screen } from '../components/screen'
import { colors, fontSize, spacing } from '../theme/tokens'

export function SettingsScreen(): JSX.Element {
  const { t } = useTranslation()
  const { state, logout } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null

  return (
    <Screen scroll>
      <PageHeader eyebrow="WIMM" title={t('nav.settings')} />

      {user ? (
        <Panel>
          <Chip label={`@${user.username}`} tone="accent" />
          <Text style={styles.email}>{user.email}</Text>
          <View style={styles.signOut}>
            <Button
              label={t('layout.signOut')}
              variant="danger"
              onPress={() => void logout()}
            />
          </View>
        </Panel>
      ) : null}

      <View style={styles.spacer} />

      <EmptyState
        title="Settings"
        subtitle="Categories, sources, rules and preferences arrive in module M9."
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  email: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  signOut: {
    marginTop: spacing.lg,
    alignItems: 'flex-start',
  },
  spacer: { height: spacing.xl },
})
