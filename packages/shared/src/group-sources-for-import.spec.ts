import {
  groupSourcesForImportSelect,
  type SourceForImportGrouping,
} from './group-sources-for-import'

describe('groupSourcesForImportSelect', () => {
  it('places BANK_ACCOUNT, CREDIT_CARD, and other types into the expected buckets', () => {
    const sources: SourceForImportGrouping[] = [
      { id: 'b1', name: 'Checking', type: 'BANK_ACCOUNT' },
      { id: 'c1', name: 'Visa', type: 'CREDIT_CARD' },
      { id: 'cash1', name: 'Cash', type: 'CASH' },
      { id: 'm1', name: 'Manual', type: 'MANUAL' },
    ]
    const g = groupSourcesForImportSelect(sources)
    expect(g.bankAccounts.map((s) => s.id)).toEqual(['b1'])
    expect(g.creditCards.map((s) => s.id)).toEqual(['c1'])
    expect(g.other.map((s) => s.id).sort()).toEqual(['cash1', 'm1'].sort())
  })

  it('returns empty arrays when there are no sources', () => {
    const g = groupSourcesForImportSelect([])
    expect(g.bankAccounts).toEqual([])
    expect(g.creditCards).toEqual([])
    expect(g.other).toEqual([])
  })
})
