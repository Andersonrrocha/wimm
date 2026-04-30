import { Test } from '@nestjs/testing'
import { Prisma, TransactionKind } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ReportsService } from './reports.service'

describe('ReportsService', () => {
  let service: ReportsService
  const prismaMock = {
    recurrence: { findMany: jest.fn() },
    source: { findMany: jest.fn() },
    transaction: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile()
    service = moduleRef.get(ReportsService)
  })

  describe('futureCommitmentsForUser', () => {
    it('filters card installment totals by expectedDueDate and excludes recurrence rows', async () => {
      prismaMock.recurrence.findMany.mockResolvedValue([])
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal(45.5) },
      })
      prismaMock.transaction.groupBy.mockResolvedValue([
        { sourceId: 's-cc', _sum: { amount: new Prisma.Decimal(45.5) } },
      ])
      prismaMock.source.findMany.mockResolvedValue([
        { id: 's-cc', name: 'Platinum' },
      ])

      await service.futureCommitmentsForUser('user-1', {
        year: 2026,
        month: 5,
      })

      expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          kind: TransactionKind.EXPENSE,
          recurrenceId: null,
          expectedDueDate: {
            gte: new Date(Date.UTC(2026, 4, 1, 0, 0, 0, 0)),
            lte: new Date(Date.UTC(2026, 5, 0, 23, 59, 59, 999)),
          },
          OR: [
            { isProjected: true },
            { installmentPlanId: { not: null } },
            { installmentTotal: { not: null } },
          ],
        }),
        _sum: { amount: true },
      })
    })
  })

  describe('monthlyForUser', () => {
    it('aggregates credit card expenses by expectedDueDate month', async () => {
      const expenseWheres: Prisma.TransactionWhereInput[] = []
      prismaMock.transaction.aggregate.mockImplementation(
        (args: { where: Prisma.TransactionWhereInput }) => {
          if (args.where.kind === TransactionKind.EXPENSE) {
            expenseWheres.push(args.where)
          }
          return Promise.resolve({ _sum: { amount: new Prisma.Decimal(0) } })
        },
      )

      await service.monthlyForUser('user-1', { year: 2026 })

      expect(expenseWheres).toHaveLength(12)
      const april = expenseWheres[3]
      expect(april.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            expectedDueDate: {
              gte: new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0)),
              lte: new Date(Date.UTC(2026, 4, 0, 23, 59, 59, 999)),
            },
          }),
        ]),
      )
    })
  })
})
