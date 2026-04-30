import type { Category, CategoryReportRow, CategoryType } from '@wimm/shared'
import type { TFunction } from 'i18next'
import type { SelectOption, SelectOptionGroup } from '../components/ui/select'

const KEY_PREFIX = 'categories.keys.' as const

export function categoryDisplayName(
  category: Pick<Category, 'name' | 'categoryKey'>,
  t: TFunction,
): string {
  const key = category.categoryKey?.trim()
  if (key) {
    const i18nKey = `${KEY_PREFIX}${key}`
    const label = t(i18nKey)
    if (label !== i18nKey) return label
  }
  return category.name
}

export function reportCategoryDisplayName(
  row: Pick<CategoryReportRow, 'name' | 'categoryKey' | 'categoryId'>,
  t: TFunction,
): string {
  if (row.categoryId == null) {
    return t('transactions.uncategorized')
  }
  const key = row.categoryKey?.trim()
  if (key) {
    const i18nKey = `${KEY_PREFIX}${key}`
    const label = t(i18nKey)
    if (label !== i18nKey) return label
  }
  if (row.name === 'Unknown category') {
    return t('transactions.unknownCategory')
  }
  return row.name
}

/**
 * Builds `leadingOptions` + `optionGroups` for the `Select` component's
 * grouped mode.
 *
 * - Categories that have children appear as non-selectable group headers;
 *   only their children are selectable.
 * - Top-level leaves (no children) appear in a flat group with no label.
 *
 * Pass `filterType` to restrict to INCOME or EXPENSE categories only.
 * Pass `leadingLabel` to add a selectable "none/all" leading option (value '').
 */
export function buildCategoryOptionGroups(
  categories: Pick<Category, 'id' | 'name' | 'categoryKey' | 'parentId' | 'type'>[],
  t: TFunction,
  options: {
    filterType?: CategoryType
    leadingLabel?: string
  } = {},
): { leadingOptions: SelectOption[]; optionGroups: SelectOptionGroup[] } {
  const filtered = options.filterType
    ? categories.filter((c) => c.type === options.filterType)
    : categories

  // Index children by parentId
  const childrenByParentId = new Map<string, typeof filtered>()
  for (const c of filtered) {
    if (c.parentId) {
      const arr = childrenByParentId.get(c.parentId) ?? []
      arr.push(c)
      childrenByParentId.set(c.parentId, arr)
    }
  }

  const toOption = (c: Pick<Category, 'id' | 'name' | 'categoryKey'>): SelectOption => ({
    value: c.id,
    label: categoryDisplayName(c, t),
  })

  const sortByLabel = <T extends Pick<Category, 'id' | 'name' | 'categoryKey'>>(arr: T[]): T[] =>
    [...arr].sort((a, b) =>
      categoryDisplayName(a, t).localeCompare(categoryDisplayName(b, t)),
    )

  // Top-level categories (parentId = null or not in the filtered list parents)
  const topLevel = filtered.filter((c) => !c.parentId)

  const groups: SelectOptionGroup[] = []
  const ungroupedOptions: SelectOption[] = []

  for (const parent of sortByLabel(topLevel)) {
    const children = childrenByParentId.get(parent.id)
    if (children && children.length > 0) {
      groups.push({
        label: categoryDisplayName(parent, t),
        options: sortByLabel(children).map(toOption),
      })
    } else {
      ungroupedOptions.push(toOption(parent))
    }
  }

  // Sort ungrouped options and place them in a no-label group at the end.
  const sortedUngrouped = ungroupedOptions.sort((a, b) =>
    String(a.label).localeCompare(String(b.label)),
  )
  if (sortedUngrouped.length > 0) {
    groups.push({ label: '', options: sortedUngrouped })
  }

  return {
    leadingOptions: options.leadingLabel !== undefined
      ? [{ value: '', label: options.leadingLabel }]
      : [],
    optionGroups: groups,
  }
}
