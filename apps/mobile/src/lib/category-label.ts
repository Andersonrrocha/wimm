import type { Category } from '@wimm/shared'
import type { TFunction } from 'i18next'

const KEY_PREFIX = 'categories.keys.' as const

/**
 * Mirrors `apps/desktop/src/renderer/lib/category-label.ts`. Falls back to
 * the user-defined `name` if no localized `categoryKey` translation exists.
 */
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
