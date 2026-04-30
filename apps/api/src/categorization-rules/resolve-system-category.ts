import { TransactionKind, type SystemCategorizationRule } from '@prisma/client'

/**
 * Generic pattern `mercado` must not match Mercado Livre descriptors: those
 * strings contain `mercado` as a substring (e.g. mercadolivre, mercadol).
 */
function shouldSkipGenericMercadoPattern(normalizedDescription: string): boolean {
  const d = normalizedDescription
  return (
    d.includes('mercadolivre') ||
    d.includes('mercado livre') ||
    d.includes('mercadol')
  )
}

export function resolveFirstSystemCategoryId(
  kind: TransactionKind,
  normalizedDescription: string,
  systemRules: Pick<
    SystemCategorizationRule,
    'pattern' | 'kind' | 'categoryKey'
  >[],
  categoryIdByKey: Map<string, string>,
): string | null {
  for (const rule of systemRules) {
    if (rule.kind !== kind) continue
    const raw = rule.pattern
    if (!raw?.trim()) continue
    // Do not trim: patterns like ` sh ` (Shell on abbreviated statements) rely
    // on leading/trailing spaces to avoid matching words such as "shopee".
    const p = raw.toLowerCase()
    if (!normalizedDescription.includes(p)) continue
    if (p === 'mercado' && shouldSkipGenericMercadoPattern(normalizedDescription)) {
      continue
    }
    const id = categoryIdByKey.get(rule.categoryKey)
    if (id) return id
  }
  return null
}
