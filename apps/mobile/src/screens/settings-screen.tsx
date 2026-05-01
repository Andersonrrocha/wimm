import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Screen } from '../components/screen'

export function SettingsScreen(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Screen>
      <PageHeader eyebrow="WIMM" title={t('nav.settings')} />
      <EmptyState
        title="Settings"
        subtitle="Categories, sources, rules and preferences arrive in module M9."
      />
    </Screen>
  )
}
