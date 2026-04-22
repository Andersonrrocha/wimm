import { TransactionKind } from '@prisma/client'
import { resolveFirstSystemCategoryId } from './resolve-system-category'

describe('resolveFirstSystemCategoryId', () => {
  const rules = [
    { pattern: 'mercadolivre', kind: TransactionKind.EXPENSE, categoryKey: 'online_shopping' },
    { pattern: 'mercado livre', kind: TransactionKind.EXPENSE, categoryKey: 'online_shopping' },
    { pattern: 'mercado', kind: TransactionKind.EXPENSE, categoryKey: 'market' },
  ]

  it('prefers mercadolivre over mercado substring', () => {
    const map = new Map([
      ['online_shopping', 'os-id'],
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
      ['online_shopping', 'os-id'],
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

  it('skips rules with missing category and continues', () => {
    const map = new Map([['market', 'm-id']])
    const id = resolveFirstSystemCategoryId(
      TransactionKind.EXPENSE,
      'pgto mercadolivre',
      rules,
      map,
    )
    expect(id).toBe('m-id')
  })

  it('matches roadget (common SHEIN legal name on statements) before generic mercado', () => {
    const extended = [
      { pattern: 'roadget', kind: TransactionKind.EXPENSE, categoryKey: 'online_shopping' },
      { pattern: 'mercado', kind: TransactionKind.EXPENSE, categoryKey: 'market' },
    ]
    const map = new Map([
      ['online_shopping', 'os-id'],
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
