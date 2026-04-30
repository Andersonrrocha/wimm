import { Test } from '@nestjs/testing'
import { Prisma, SourceType, TransactionKind } from '@prisma/client'
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

  describe('createForUser', () => {
    it('persists billing metadata for credit card source', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 10,
      })
      prismaMock.transaction.create.mockResolvedValue({ id: 't1' })

      await service.createForUser('user-1', {
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
          amount: new Prisma.Decimal(10.5),
        }),
      })
    })

    it('sets billing fields null for bank account source', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.BANK_ACCOUNT,
        closingDay: null,
        dueDay: null,
      })
      prismaMock.transaction.create.mockResolvedValue({ id: 't1' })

      await service.createForUser('user-1', {
        ...baseDto,
        sourceId: 'src-bank',
      })

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billingCycleMonth: null,
          billingCycleYear: null,
          expectedDueDate: null,
        }),
      })
    })

    it('applies year rollover billing when purchase is after December close', async () => {
      prismaMock.source.findFirst.mockResolvedValue({
        type: SourceType.CREDIT_CARD,
        closingDay: 25,
        dueDay: 12,
      })
      prismaMock.transaction.create.mockResolvedValue({ id: 't1' })

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
      prismaMock.transaction.update.mockResolvedValue({ id: 't1' })

      await service.updateForUser('user-1', 't1', { description: 'Tea' })

      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({
          description: 'Tea',
          billingCycleMonth: 1,
          billingCycleYear: 2024,
          expectedDueDate: new Date(Date.UTC(2024, 1, 10)),
        }),
      })
    })
  })
})
