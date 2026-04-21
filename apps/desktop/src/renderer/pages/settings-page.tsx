import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PageHeader } from '../components/ui/page-header'
import { Tabs } from '../components/ui/tabs'
import type { QuickAddTab } from '../components/quick-add-modal'
import { CategoriesTab } from './settings/categories-tab'
import { SourcesTab } from './settings/sources-tab'
import { RulesTab } from './settings/rules-tab'

type OutletCtx = {
  openQuickAdd: (tab?: QuickAddTab) => void
}

type SectionId = 'categories' | 'sources' | 'rules'

/**
 * Unified settings surface for bookkeeping data: categories, sources,
 * and categorization rules. Creation for the first two is surfaced through
 * the global Quick Add modal — tabs here are list-centric.
 */
export function SettingsPage(): JSX.Element {
  const { openQuickAdd } = useOutletContext<OutletCtx>()
  const [section, setSection] = useState<SectionId>('categories')

  return (
    <div className="wm-page">
      <PageHeader
        eyebrow="Bookkeeping"
        title="Settings"
        subtitle="Manage categories, sources and categorization rules. Use + Add or ⌘K anywhere to create new entries quickly."
      />

      <Tabs
        value={section}
        onValueChange={(v) => setSection(v as SectionId)}
        defaultValue={section}
      >
        <Tabs.List ariaLabel="Settings sections">
          <Tabs.Trigger value="categories">Categories</Tabs.Trigger>
          <Tabs.Trigger value="sources">Sources</Tabs.Trigger>
          <Tabs.Trigger value="rules">Rules</Tabs.Trigger>
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
      </Tabs>
    </div>
  )
}
