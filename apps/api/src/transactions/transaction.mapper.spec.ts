import { Prisma } from '@prisma/client'
import { toTransactionDto } from './transaction.mapper'

describe('toTransactionDto', () => {
  const row = {
    id: 't-1',
    userId: 'u-1',
    sourceId: 's-1',
    categoryId: 'c-1',
    importBatchId: null,
    installmentPlanId: null,
    isProjected: false,
    isConfirmedFromImport: false,
    recurrenceId: null,
    kind: 'EXPENSE' as const,
    amount: new Prisma.Decimal('150.45'),
    description: 'Mercado Central',
    occurredAt: new Date('2026-03-15T00:00:00.000Z'),
    fingerprint: 'abc',
    billingCycleMonth: 3,
    billingCycleYear: 2026,
    expectedDueDate: new Date('2026-04-10T00:00:00.000Z'),
    installmentCurrent: 2,
    installmentTotal: 12,
    createdAt: new Date('2026-03-16T10:00:00.000Z'),
    updatedAt: new Date('2026-03-16T10:00:00.000Z'),
  }

  it('renders amount as a two-decimal string', () => {
    expect(toTransactionDto(row).amount).toBe('150.45')
  })

  it('renders whole values with trailing zeros', () => {
    expect(toTransactionDto({ ...row, amount: new Prisma.Decimal('7') }).amount).toBe(
      '7.00',
    )
  })

  it('renders dates as ISO strings', () => {
    const dto = toTransactionDto(row)
    expect(dto.occurredAt).toBe('2026-03-15T00:00:00.000Z')
    expect(dto.createdAt).toBe('2026-03-16T10:00:00.000Z')
    expect(dto.updatedAt).toBe('2026-03-16T10:00:00.000Z')
  })

  it('renders a present expectedDueDate as an ISO string', () => {
    expect(toTransactionDto(row).expectedDueDate).toBe('2026-04-10T00:00:00.000Z')
  })

  it('preserves a null expectedDueDate', () => {
    expect(toTransactionDto({ ...row, expectedDueDate: null }).expectedDueDate).toBeNull()
  })

  it('preserves nullable relations', () => {
    const dto = toTransactionDto({ ...row, categoryId: null, sourceId: null })
    expect(dto.categoryId).toBeNull()
    expect(dto.sourceId).toBeNull()
  })

  it('preserves installment and projection fields', () => {
    const dto = toTransactionDto({
      ...row,
      installmentPlanId: 'ip-1',
      isProjected: true,
      isConfirmedFromImport: true,
    })
    expect(dto.installmentPlanId).toBe('ip-1')
    expect(dto.isProjected).toBe(true)
    expect(dto.isConfirmedFromImport).toBe(true)
    expect(dto.installmentCurrent).toBe(2)
    expect(dto.installmentTotal).toBe(12)
  })

  it('parses kind through parseEnum and throws on an invalid value', () => {
    expect(toTransactionDto(row).kind).toBe('EXPENSE')
    expect(() => toTransactionDto({ ...row, kind: 'NOT_A_KIND' })).toThrow(RangeError)
  })
})
