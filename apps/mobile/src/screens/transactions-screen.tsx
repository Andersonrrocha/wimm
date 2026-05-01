import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Screen } from '../components/screen'

export function TransactionsScreen(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Screen>
      <PageHeader eyebrow="WIMM" title={t('nav.transactions')} />
      <EmptyState
        title="Transactions"
        subtitle="List, filters and edit/delete actions arrive in module M4."
      />
    </Screen>
  )
}
