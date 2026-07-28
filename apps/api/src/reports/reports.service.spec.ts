import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { TransactionKind } from '@wimm/shared'
import { PrismaService } from '../prisma/prisma.service'
import { ReportsService } from './reports.service'

describe('ReportsService', () => {
  let service: ReportsService
  const prismaMock = {
    category: { findMany: jest.fn() },
    recurrence: { findMany: jest.fn() },
    source: { findMany: jest.fn() },
    transaction: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    // Default chartDateMode = BILLING_CYCLE preserves the historical behaviour
    // these tests assert against. Individual tests can override per-call.
    prismaMock.user.findUnique.mockResolvedValue({ chartDateMode: 'BILLING_CYCLE' })
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile()
    service = moduleRef.get(ReportsService)
  })

  describe('summaryForUser', () => {
    it('renders income, expense, and net as two-decimal strings from cent aggregates', async () => {
      prismaMock.transaction.aggregate.mockImplementation(
        (args: { where: Prisma.TransactionWhereInput }) => {
          if (args.where.kind === TransactionKind.INCOME) {
            return Promise.resolve({ _sum: { amountCents: 3859582 } })
          }
          return Promise.resolve({ _sum: { amountCents: 3759582 } })
        },
      )

      const result = await service.summaryForUser('user-1', {
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(result).toEqual({
        income: '38595.82',
        expense: '37595.82',
        net: '1000.00',
      })
    })

    it('pins the sub-unit boundary: 50 cents and 5 cents render with two decimals', async () => {
      prismaMock.transaction.aggregate.mockImplementation(
        (args: { where: Prisma.TransactionWhereInput }) => {
          if (args.where.kind === TransactionKind.INCOME) {
            return Promise.resolve({ _sum: { amountCents: 50 } })
          }
          return Promise.resolve({ _sum: { amountCents: 5 } })
        },
      )

      const result = await service.summaryForUser('user-1', {
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(result).toEqual({
        income: '0.50',
        expense: '0.05',
        net: '0.45',
      })
    })
  })

  describe('byCategoryForUser', () => {
    it('rolls up child categories into their parent total and keeps a parentless category under its own name', async () => {
      // Income: a single parentless category ("Solo Category").
      prismaMock.transaction.groupBy.mockResolvedValueOnce([
        { categoryId: 'c-solo', _sum: { amountCents: 500000 } },
      ])
      // Expense: two children of the same parent — this is where an
      // accumulator bug would hide, since both must fold into one entry.
      prismaMock.transaction.groupBy.mockResolvedValueOnce([
        { categoryId: 'c-a', _sum: { amountCents: 1000000 } },
        { categoryId: 'c-b', _sum: { amountCents: 938449 } },
      ])
      prismaMock.category.findMany.mockResolvedValueOnce([
        { id: 'c-solo', name: 'Solo Category', categoryKey: null, parentId: null },
        { id: 'c-a', name: 'Child A', categoryKey: null, parentId: 'p-1' },
        { id: 'c-b', name: 'Child B', categoryKey: null, parentId: 'p-1' },
      ])
      prismaMock.category.findMany.mockResolvedValueOnce([
        { id: 'p-1', name: 'Parent Category', categoryKey: null },
      ])

      const result = await service.byCategoryForUser('user-1', {
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(result.items).toEqual([
        {
          categoryId: 'p-1',
          categoryKey: null,
          name: 'Parent Category',
          kind: TransactionKind.EXPENSE,
          // 1000000 + 938449 cents — sum of both children, not just one.
          total: '19384.49',
        },
        {
          categoryId: 'c-solo',
          categoryKey: null,
          name: 'Solo Category',
          kind: TransactionKind.INCOME,
          total: '5000.00',
        },
      ])
    })
  })

  describe('futureCommitmentsForUser', () => {
    it('filters card installment totals by expectedDueDate and excludes recurrence rows', async () => {
      prismaMock.recurrence.findMany.mockResolvedValue([])
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amountCents: 4550 },
      })
      prismaMock.transaction.groupBy.mockResolvedValue([
        { sourceId: 's-cc', _sum: { amountCents: 4550 } },
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
        _sum: { amountCents: true },
      })
    })

    it('renders future-commitment totals as two-decimal strings', async () => {
      prismaMock.recurrence.findMany.mockResolvedValue([])
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amountCents: 300000 },
      })
      prismaMock.transaction.groupBy.mockResolvedValue([
        { sourceId: 's-cc', _sum: { amountCents: 300000 } },
      ])
      prismaMock.source.findMany.mockResolvedValue([
        { id: 's-cc', name: 'Platinum' },
      ])

      const result = await service.futureCommitmentsForUser('user-1', {
        year: 2026,
        month: 5,
      })

      expect(result).toEqual({
        year: 2026,
        month: 5,
        recurringExpenseTotal: '0.00',
        recurringIncomeTotal: '0.00',
        cardInstallmentsTotal: '3000.00',
        totalCommittedExpense: '3000.00',
        cardBySource: [
          { sourceId: 's-cc', sourceName: 'Platinum', total: '3000.00' },
        ],
      })
    })

    it('renders zero future commitments as 0.00, not 0, null, or undefined', async () => {
      prismaMock.recurrence.findMany.mockResolvedValue([])
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amountCents: null },
      })
      prismaMock.transaction.groupBy.mockResolvedValue([])

      const result = await service.futureCommitmentsForUser('user-1', {
        year: 2026,
        month: 5,
      })

      expect(result).toEqual({
        year: 2026,
        month: 5,
        recurringExpenseTotal: '0.00',
        recurringIncomeTotal: '0.00',
        cardInstallmentsTotal: '0.00',
        totalCommittedExpense: '0.00',
        cardBySource: [],
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
          return Promise.resolve({ _sum: { amountCents: 0 } })
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

    it('renders 0.00 for income, expense, and net when a month has no matching rows', async () => {
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amountCents: null },
      })

      const result = await service.monthlyForUser('user-1', { year: 2026 })

      expect(result.months[0]).toEqual({
        month: 1,
        label: 'Jan',
        income: '0.00',
        expense: '0.00',
        net: '0.00',
      })
    })
  })
})
