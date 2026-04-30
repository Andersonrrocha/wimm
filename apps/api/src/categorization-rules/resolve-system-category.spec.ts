import { TransactionKind } from '@prisma/client'
import { resolveFirstSystemCategoryId } from './resolve-system-category'

describe('resolveFirstSystemCategoryId', () => {
  const rules = [
    { pattern: 'mercadolivre', kind: TransactionKind.EXPENSE, categoryKey: 'shopping_other' },
    { pattern: 'mercado livre', kind: TransactionKind.EXPENSE, categoryKey: 'shopping_other' },
    { pattern: 'mercado', kind: TransactionKind.EXPENSE, categoryKey: 'market' },
  ]

  it('prefers mercadolivre over mercado substring', () => {
    const map = new Map([
      ['shopping_other', 'os-id'],
      ['market', 'm-id'],
    ])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'pgto mercadolivre 123',
      rules,
      map,
    )
    expect(id).toBe('os-id')
  })

  it('uses mercado when ML patterns do not match', () => {
    const map = new Map([
      ['shopping_other', 'os-id'],
      ['market', 'm-id'],
    ])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'compra supermercado x',
      rules,
      map,
    )
    expect(id).toBe('m-id')
  })

  it('does not fall through to mercado when ML-specific text matches but shopping map is missing', () => {
    const map = new Map([['market', 'm-id']])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'pgto mercadolivre',
      rules,
      map,
    )
    expect(id).toBe(null)
  })

  it('does not classify Mercado Livre establishment abbreviations as market', () => {
    const map = new Map([
      ['shopping_other', 'os-id'],
      ['market', 'm-id'],
    ])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'mercadolivre mercadol osasco bra',
      rules,
      map,
    )
    expect(id).toBe('os-id')
  })

  it('matches roadget (common SHEIN legal name on statements) before generic mercado', () => {
    const extended = [
      { pattern: 'roadget', kind: TransactionKind.EXPENSE, categoryKey: 'shopping_clothing' },
      { pattern: 'mercado', kind: TransactionKind.EXPENSE, categoryKey: 'market' },
    ]
    const map = new Map([
      ['shopping_clothing', 'os-id'],
      ['market', 'm-id'],
    ])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'roadget business pte ltd',
      extended,
      map,
    )
    expect(id).toBe('os-id')
  })
})
