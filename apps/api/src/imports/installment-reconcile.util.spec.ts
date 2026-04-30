import {
  pickUniqueReconcilableCandidate,
  projectedDescriptionMatchesImport,
  stripProjectedInstallmentDescriptionSuffix,
} from './installment-reconcile.util'

describe('stripProjectedInstallmentDescriptionSuffix', () => {
  it('removes projected suffix', () => {
    expect(
      stripProjectedInstallmentDescriptionSuffix('MERCADO · 2/5 (projected)'),
    ).toBe('MERCADO')
  })
})

describe('projectedDescriptionMatchesImport', () => {
  it('matches ignoring case and extra spaces', () => {
    expect(
      projectedDescriptionMatchesImport(
        'Mercado Livre · 3/5 (projected)',
        '  mercado livre  ',
      ),
    ).toBe(true)
  })

  it('rejects different merchant base', () => {
    expect(
      projectedDescriptionMatchesImport(
        'OTHER · 3/5 (projected)',
        'MERCADO',
      ),
    ).toBe(false)
  })
})

describe('pickUniqueReconcilableCandidate', () => {
  it('returns id when exactly one candidate matches description', () => {
    const id = pickUniqueReconcilableCandidate(
      [{ id: 'a', description: 'X · 2/5 (projected)' }],
      'X',
    )
    expect(id).toBe('a')
  })

  it('returns null when no candidate matches', () => {
    expect(
      pickUniqueReconcilableCandidate(
        [{ id: 'a', description: 'Y · 2/5 (projected)' }],
        'X',
      ),
    ).toBeNull()
  })

  it('returns null when two candidates match (ambiguous)', () => {
    expect(
      pickUniqueReconcilableCandidate(
        [
          { id: 'a', description: 'X · 2/5 (projected)' },
          { id: 'b', description: 'X · 2/5 (projected)' },
        ],
        'X',
      ),
    ).toBeNull()
  })
})
