import { TransactionKind, type SystemCategorizationRule } from '@prisma/client'

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
    const p = rule.pattern.trim().toLowerCase()
    if (!p || !normalizedDescription.includes(p)) continue
    const id = categoryIdByKey.get(rule.categoryKey)
    if (id) return id
  }
  return null
}
