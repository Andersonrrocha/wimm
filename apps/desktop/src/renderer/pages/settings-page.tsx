import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { PageHeader } from '../components/ui/page-header'
import { Tabs } from '../components/ui/tabs'
import type { QuickAddTab } from '../components/quick-add-modal'
import { CategoriesTab } from './settings/categories-tab'
import { PreferencesTab } from './settings/preferences-tab'
import { SourcesTab } from './settings/sources-tab'
import { RulesTab } from './settings/rules-tab'

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

type SectionId = 'categories' | 'sources' | 'rules' | 'preferences'

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const { openQuickAdd } = useOutletContext<OutletCtx>()
  const [section, setSection] = useState<SectionId>('categories')

  return (
    <div className="mx-auto flex max-w-container flex-col gap-6">
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      <Tabs
        value={section}
        onValueChange={(v) => setSection(v as SectionId)}
        defaultValue={section}
      >
        <Tabs.List ariaLabel={t('settings.tabsAria')}>
          <Tabs.Trigger value="categories">
            {t('settings.tabCategories')}
          </Tabs.Trigger>
          <Tabs.Trigger value="sources">{t('settings.tabSources')}</Tabs.Trigger>
          <Tabs.Trigger value="rules">{t('settings.tabRules')}</Tabs.Trigger>
          <Tabs.Trigger value="preferences">
            {t('settings.tabPreferences')}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Panel value="categories">
          <CategoriesTab onNewCategory={() => openQuickAdd('category')} />
        </Tabs.Panel>
        <Tabs.Panel value="sources">
          <SourcesTab onNewSource={() => openQuickAdd('source')} />
        </Tabs.Panel>
        <Tabs.Panel value="rules">
          <RulesTab />
        </Tabs.Panel>
        <Tabs.Panel value="preferences">
          <PreferencesTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}
