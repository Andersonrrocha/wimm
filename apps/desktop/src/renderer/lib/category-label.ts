import type { Category, CategoryReportRow } from '@wimm/shared'
import type { TFunction } from 'i18next'

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
  row: Pick<CategoryReportRow, 'name' | 'categoryKey'>,
  t: TFunction,
): string {
  const key = row.categoryKey?.trim()
  if (key) {
    const i18nKey = `${KEY_PREFIX}${key}`
    const label = t(i18nKey)
    if (label !== i18nKey) return label
  }
  return row.name
}
