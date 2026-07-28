import { Test } from '@nestjs/testing'
import { SourceType, TransactionKind } from '@wimm/shared'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionsService } from './transactions.service'

describe('TransactionsService', () => {
  let service: TransactionsService
  const prismaMock = {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    source: { findFirst: jest.fn() },
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile()
    service = moduleRef.get(TransactionsService)
  })

  const baseDto = {
    kind: TransactionKind.EXPENSE,
    amount: 10.5,
    description: 'Coffee',
    occurredAt: '2024-01-10T00:00:00.000Z',
  }

  /**
   * Full row shape the mapper requires. `create`/`update` mocks below extend
   * this rather than returning a bare `{ id: 't1' }`, since `toTransactionDto`
   * now runs on whatever Prisma resolves with.
   */
  const baseRow = {
    id: 't1',
    userId: 'user-1',
    sourceId: null,
    categoryId: null,
    importBatchId: null,
    installmentPlanId: null,
    isProjected: false,
    isConfirmedFromImport: false,
    recurrenceId: null,
    kind: 'EXPENSE',
    amountCents: 1050,
    description: 'Coffee',
    occurredAt: new Date('2024-01-10T00:00:00.000Z'),
    fingerprint: null,
    billingCycleMonth: null,
    billingCycleYear: null,
    expectedDueDate: null,
    installmentCurrent: null,
    installmentTotal: null,
    createdAt: new Date('2024-01-10T00:00:00.000Z'),
    updatedAt: new Date('2024-01-10T00:00:00.000Z'),
  }

  describe('createForUser', () => {
    it('persists billing metadata for credit card source', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 10,
      })
      prismaMock.transaction.create.mockResolvedValue({
        ...baseRow,
        sourceId: 'src-cc',
        billingCycleMonth: 1,
        billingCycleYear: 2024,
        expectedDueDate: new Date(Date.UTC(2024, 1, 10)),
      })

      const result = await service.createForUser('user-1', {
        ...baseDto,
        sourceId: 'src-cc',
      })

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          sourceId: 'src-cc',
          billingCycleMonth: 1,
          billingCycleYear: 2024,
          expectedDueDate: new Date(Date.UTC(2024, 1, 10)),
          // Non-whole cents source value (10.50 -> 1050) so a dropped-fraction
          // bug in the cents conversion would fail this assertion.
          amountCents: 1050,
        }),
      })
      // Mapped DTO shape: amount is a two-decimal string, dates are ISO strings.
      expect(result.amount).toBe('10.50')
      expect(result.expectedDueDate).toBe(new Date(Date.UTC(2024, 1, 10)).toISOString())
    })

    it('sets billing fields null for bank account source', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.BANK_ACCOUNT,
        closingDay: null,
        dueDay: null,
      })
      prismaMock.transaction.create.mockResolvedValue({
        ...baseRow,
        sourceId: 'src-bank',
      })

      await service.createForUser('user-1', {
        ...baseDto,
        sourceId: 'src-bank',
      })

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billingCycleMonth: null,
          billingCycleYear: null,
          expectedDueDate: null,
          amountCents: 1050,
        }),
      })
    })

    it('applies year rollover billing when purchase is after December close', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 12,
      })
      prismaMock.transaction.create.mockResolvedValue({
        ...baseRow,
        sourceId: 'src-cc',
        billingCycleMonth: 1,
        billingCycleYear: 2025,
        expectedDueDate: new Date(Date.UTC(2025, 1, 12)),
      })

      await service.createForUser('user-1', {
        ...baseDto,
        occurredAt: '2024-12-26T00:00:00.000Z',
        sourceId: 'src-cc',
      })

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billingCycleMonth: 1,
          billingCycleYear: 2025,
          expectedDueDate: new Date(Date.UTC(2025, 1, 12)),
          amountCents: 1050,
        }),
      })
    })
  })

  describe('listForUser', () => {
    it('excludes projected installment rows when includeProjected is false', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([])
      prismaMock.transaction.count.mockResolvedValue(0)

      await service.listForUser('user-1', {
        includeProjected: 'false',
        page: 1,
        pageSize: 20,
      })

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            isProjected: false,
          }),
        }),
      )
    })

    it('does not filter isProjected when includeProjected is true', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([])
      prismaMock.transaction.count.mockResolvedValue(0)

      await service.listForUser('user-1', {
        includeProjected: 'true',
        page: 1,
        pageSize: 20,
      })

      const call = prismaMock.transaction.findMany.mock.calls[0]?.[0]
      expect(call?.where).not.toHaveProperty('isProjected')
    })

    it('filters uncategorized when uncategorizedOnly is true', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([])
      prismaMock.transaction.count.mockResolvedValue(0)

      await service.listForUser('user-1', {
        uncategorizedOnly: 'true',
        page: 1,
        pageSize: 20,
      })

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            categoryId: null,
          }),
        }),
      )
    })
  })

  describe('updateForUser', () => {
    it('recomputes billing when source and date unchanged still matches create logic', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue({
        id: 't1',
        userId: 'user-1',
        sourceId: 'src-cc',
        occurredAt: new Date('2024-01-10T00:00:00.000Z'),
      })
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 10,
      })
      prismaMock.transaction.update.mockResolvedValue({
        ...baseRow,
        sourceId: 'src-cc',
        description: 'Tea',
        billingCycleMonth: 1,
        billingCycleYear: 2024,
        expectedDueDate: new Date(Date.UTC(2024, 1, 10)),
      })

      const result = await service.updateForUser('user-1', 't1', { description: 'Tea' })

      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({
          description: 'Tea',
          billingCycleMonth: 1,
          billingCycleYear: 2024,
          expectedDueDate: new Date(Date.UTC(2024, 1, 10)),
        }),
      })
      expect(result.description).toBe('Tea')
      expect(result.amount).toBe('10.50')
    })

    it('writes amountCents converted from the input value when amount changes', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue({
        id: 't1',
        userId: 'user-1',
        sourceId: null,
        occurredAt: new Date('2024-01-10T00:00:00.000Z'),
      })
      prismaMock.transaction.update.mockResolvedValue({
        ...baseRow,
        amountCents: 15045,
      })

      await service.updateForUser('user-1', 't1', { amount: 150.45 })

      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({
          // Non-whole cents (150.45 -> 15045) so a dropped-fraction bug in
          // the conditional update branch would fail this assertion.
          amountCents: 15045,
        }),
      })
    })
  })
})
