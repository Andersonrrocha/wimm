import { Test } from '@nestjs/testing'
import { Prisma } from '@prisma/client'
import {
  RecurrenceEndMode,
  RecurrenceFrequency,
  TransactionKind,
} from '@wimm/shared'
import { PrismaService } from '../prisma/prisma.service'
import { RecurrencesService } from './recurrences.service'

describe('RecurrencesService', () => {
  let service: RecurrencesService
  const prismaMock = {
    recurrence: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    source: { findFirst: jest.fn() },
    category: { findFirst: jest.fn() },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecurrencesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile()
    service = moduleRef.get(RecurrencesService)
  })

  const baseDto = {
    kind: TransactionKind.EXPENSE,
    amount: 150.45,
    description: 'Gym membership',
    frequency: RecurrenceFrequency.MONTHLY,
    startDate: '2024-01-10T00:00:00.000Z',
    endMode: RecurrenceEndMode.INDEFINITE,
  }

  /** Full row shape the mapper/service expects back from Prisma. */
  const baseRow = {
    id: 'r1',
    userId: 'user-1',
    kind: 'EXPENSE',
    amount: new Prisma.Decimal(150.45),
    description: 'Gym membership',
    sourceId: null,
    categoryId: null,
    frequency: 'MONTHLY',
    startDate: new Date('2024-01-10T00:00:00.000Z'),
    endMode: 'INDEFINITE',
    endDate: null,
    active: true,
    createdAt: new Date('2024-01-10T00:00:00.000Z'),
    updatedAt: new Date('2024-01-10T00:00:00.000Z'),
  }

  describe('createForUser', () => {
    it('dual-writes amount and amountCents from the same input value', async () => {
      prismaMock.recurrence.create.mockResolvedValue(baseRow)

      await service.createForUser('user-1', baseDto)

      expect(prismaMock.recurrence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: new Prisma.Decimal(150.45),
          // Non-whole cents (150.45 -> 15045); a whole-dollar fixture would
          // mask several classes of conversion error here.
          amountCents: 15045,
        }),
      })
    })
  })

  describe('updateForUser', () => {
    it('dual-writes amount and amountCents together when amount changes', async () => {
      prismaMock.recurrence.findFirst.mockResolvedValue(baseRow)
      prismaMock.recurrence.update.mockResolvedValue({
        ...baseRow,
        amount: new Prisma.Decimal(75.31),
      })

      await service.updateForUser('user-1', 'r1', { amount: 75.31 })

      expect(prismaMock.recurrence.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({
          amount: new Prisma.Decimal(75.31),
          amountCents: 7531,
        }),
      })
    })
  })

  describe('materializeForUser', () => {
    it('dual-writes amount and amountCents on each generated transaction', async () => {
      prismaMock.recurrence.findFirst.mockResolvedValue(baseRow)
      prismaMock.transaction.findFirst.mockResolvedValue(null)
      prismaMock.transaction.create.mockResolvedValue({})

      const result = await service.materializeForUser('user-1', {
        recurrenceId: 'r1',
        until: '2024-01-10',
      })

      expect(result.created).toBe(1)
      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: baseRow.amount,
          amountCents: 15045,
        }),
      })
    })
  })
})
