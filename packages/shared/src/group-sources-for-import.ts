/** Aligned with SourceType on the main Source model */
export type SourceTypeForImport = 'BANK_ACCOUNT' | 'CREDIT_CARD' | 'CASH' | 'MANUAL'

/** Minimal fields needed to build import UI groups */
export type SourceForImportGrouping = {
  id: string
  name: string
  type: SourceTypeForImport
}

export interface SourcesGroupedForImportSelect {
  bankAccounts: SourceForImportGrouping[]
  creditCards: SourceForImportGrouping[]
  other: SourceForImportGrouping[]
}

/**
 * Splits sources into ordered groups for statement import:
 * bank accounts, credit cards, then other (cash / manual).
 */
export function groupSourcesForImportSelect(
  sources: readonly SourceForImportGrouping[],
): SourcesGroupedForImportSelect {
  const bankAccounts: SourceForImportGrouping[] = []
  const creditCards: SourceForImportGrouping[] = []
  const other: SourceForImportGrouping[] = []

  for (const s of sources) {
    const t = s.type
    if (t === 'BANK_ACCOUNT') bankAccounts.push(s)
    else if (t === 'CREDIT_CARD') creditCards.push(s)
    else other.push(s)
  }

  return { bankAccounts, creditCards, other }
}
