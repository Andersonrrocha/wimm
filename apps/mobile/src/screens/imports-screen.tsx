import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { Screen } from '../components/screen'

export function ImportsScreen(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Screen>
      <PageHeader eyebrow="WIMM" title={t('nav.imports')} />
      <EmptyState
        title="Imports"
        subtitle="CSV, OFX and PDF wizard arrives in module M7."
      />
    </Screen>
  )
}
