import type { TFunction } from 'i18next'

/**
 * Suffix added by the API for projected installment legs (stable English in DB).
 * @see apps/api/src/imports/installment-reconcile.util.ts
 */
const PROJECTED_INSTALLMENT_EN_RE = / · \d+\/\d+ \(projected\)$/
const PROJECTED_STANDALONE_EN_RE = / \(projected\)$/

interface StripResult {
  base: string
  hadSuffix: boolean
}

function stripEnglishProjectedSuffix(description: string): StripResult {
  if (PROJECTED_INSTALLMENT_EN_RE.test(description)) {
    return {
      base: description.replace(PROJECTED_INSTALLMENT_EN_RE, ''),
      hadSuffix: true,
    }
  }
  if (PROJECTED_STANDALONE_EN_RE.test(description)) {
    return {
      base: description.replace(PROJECTED_STANDALONE_EN_RE, ''),
      hadSuffix: true,
    }
  }
  return { base: description, hadSuffix: false }
}

export function formatTransactionDescriptionForDisplay(
  description: string,
  isProjected: boolean | undefined,
  t: TFunction,
): string {
  const raw = description ?? ''
  const { base, hadSuffix } = stripEnglishProjectedSuffix(raw)
  if (hadSuffix) {
    const main = base.trim() || t('transactions.untitled')
    return `${main} (${t('transactions.projectedParens')})`
  }
  if (isProjected === true) {
    return raw.trim() || t('transactions.untitled')
  }
  return raw || t('transactions.untitled')
}
