import { Prisma } from '@prisma/client'
import { toRecurrenceDto } from './recurrence.mapper'

describe('toRecurrenceDto', () => {
  const row = {
    id: 'r-1',
    userId: 'u-1',
    kind: 'EXPENSE' as const,
    amount: new Prisma.Decimal('99.90'),
    description: 'Streaming',
    sourceId: 's-1',
    categoryId: 'c-1',
    frequency: 'MONTHLY' as const,
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endMode: 'INDEFINITE' as const,
    endDate: null,
    active: true,
    createdAt: new Date('2026-01-10T10:00:00.000Z'),
    updatedAt: new Date('2026-01-10T10:00:00.000Z'),
  }

  it('renders amount as a two-decimal string', () => {
    expect(toRecurrenceDto(row).amount).toBe('99.90')
  })

  it('renders whole values with trailing zeros', () => {
    expect(toRecurrenceDto({ ...row, amount: new Prisma.Decimal('50') }).amount).toBe(
      '50.00',
    )
  })

  it('renders dates as ISO strings', () => {
    const dto = toRecurrenceDto(row)
    expect(dto.startDate).toBe('2026-01-10T00:00:00.000Z')
    expect(dto.createdAt).toBe('2026-01-10T10:00:00.000Z')
    expect(dto.updatedAt).toBe('2026-01-10T10:00:00.000Z')
  })

  it('preserves an absent end date', () => {
    expect(toRecurrenceDto(row).endDate).toBeNull()
  })

  it('renders a present endDate as an ISO string', () => {
    const dto = toRecurrenceDto({
      ...row,
      endMode: 'UNTIL_DATE' as const,
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    })
    expect(dto.endDate).toBe('2026-12-31T00:00:00.000Z')
  })

  it('preserves the active flag', () => {
    expect(toRecurrenceDto(row).active).toBe(true)
    expect(toRecurrenceDto({ ...row, active: false }).active).toBe(false)
  })

  it('preserves nullable relations', () => {
    const dto = toRecurrenceDto({ ...row, categoryId: null, sourceId: null })
    expect(dto.categoryId).toBeNull()
    expect(dto.sourceId).toBeNull()
  })

  it('parses kind, frequency and endMode through parseEnum', () => {
    const dto = toRecurrenceDto(row)
    expect(dto.kind).toBe('EXPENSE')
    expect(dto.frequency).toBe('MONTHLY')
    expect(dto.endMode).toBe('INDEFINITE')
  })

  it('throws on an invalid kind, frequency or endMode', () => {
    expect(() => toRecurrenceDto({ ...row, kind: 'NOT_A_KIND' })).toThrow(RangeError)
    expect(() => toRecurrenceDto({ ...row, frequency: 'NOT_A_FREQ' })).toThrow(
      RangeError,
    )
    expect(() => toRecurrenceDto({ ...row, endMode: 'NOT_A_MODE' })).toThrow(RangeError)
  })
})
