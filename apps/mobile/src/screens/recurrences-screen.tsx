import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Screen } from '../components/screen'

export function RecurrencesScreen(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Screen>
      <PageHeader eyebrow="WIMM" title={t('nav.recurrences')} />
      <EmptyState
        title="Recurrences"
        subtitle="List, create, edit and materialize arrive in module M8."
      />
    </Screen>
  )
}
