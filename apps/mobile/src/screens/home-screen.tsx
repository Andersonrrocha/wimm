import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Screen } from '../components/screen'

export function HomeScreen(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Screen>
      <PageHeader eyebrow="WIMM" title={t('nav.home')} />
      <EmptyState
        title="Dashboard"
        subtitle="Reports, KPIs and charts arrive in module M6."
      />
    </Screen>
  )
}
