import { Test } from '@nestjs/testing'
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
    amountCents: 15045,
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
    it('writes amountCents converted from the input value', async () => {
      prismaMock.recurrence.create.mockResolvedValue(baseRow)

      await service.createForUser('user-1', baseDto)

      expect(prismaMock.recurrence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          // Non-whole cents (150.45 -> 15045); a whole-dollar fixture would
          // mask several classes of conversion error here.
          amountCents: 15045,
        }),
      })
    })
  })

  describe('updateForUser', () => {
    it('writes amountCents converted from the input value when amount changes', async () => {
      prismaMock.recurrence.findFirst.mockResolvedValue(baseRow)
      prismaMock.recurrence.update.mockResolvedValue({
        ...baseRow,
        amountCents: 7531,
      })

      await service.updateForUser('user-1', 'r1', { amount: 75.31 })

      expect(prismaMock.recurrence.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({
          amountCents: 7531,
        }),
      })
    })
  })

  describe('materializeForUser', () => {
    it('writes amountCents from the recurrence on each generated transaction', async () => {
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
          amountCents: 15045,
        }),
      })
    })

    it('rejects a corrupt kind on the active-recurrence load before writing anything', async () => {
      // No recurrenceId, so this exercises the findMany({ active: true })
      // branch that batch materialization (e.g. a cron) runs through.
      prismaMock.recurrence.findMany.mockResolvedValue([
        { ...baseRow, kind: 'GARBAGE' },
      ])
      prismaMock.transaction.findFirst.mockResolvedValue(null)
      prismaMock.transaction.create.mockResolvedValue({})

      await expect(
        service.materializeForUser('user-1', { until: '2024-01-10' }),
      ).rejects.toThrow(RangeError)

      // The valuable assertion: parsing happens before the per-recurrence
      // loop, so a corrupt row must not leave a partial write behind.
      expect(prismaMock.transaction.create).not.toHaveBeenCalled()
    })
  })
})
