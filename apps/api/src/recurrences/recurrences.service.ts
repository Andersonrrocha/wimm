import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Prisma,
  RecurrenceEndMode,
  type RecurrenceFrequency,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { assertCategoryIsLeaf } from '../categories/assert-category-leaf'
import {
  resolveTransactionBillingFields,
  type SourceBillingInput,
  TransactionBillingConfigError,
} from '../transactions/transaction-billing.util'
import {
  endOfUtcDayFromDateString,
  nextOccurrence,
  recurrenceTransactionFingerprint,
  toUtcDateKey,
} from './recurrence-dates'
import type { CreateRecurrenceDto } from './dto/create-recurrence.dto'
import type { MaterializeDto } from './dto/materialize.dto'
import type { UpdateRecurrenceDto } from './dto/update-recurrence.dto'

const MAX_MATERIALIZE_STEPS = 10_000
const MAX_HORIZON_MONTHS = 24

@Injectable()
export class RecurrencesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    return this.prisma.recurrence.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOneForUser(userId: string, id: string) {
    const row = await this.prisma.recurrence.findFirst({
      where: { id, userId },
    })
    if (!row) throw new NotFoundException('Recurrence not found')
    return row
  }

  async createForUser(userId: string, dto: CreateRecurrenceDto) {
    const endForCheck: Date | null =
      dto.endMode === RecurrenceEndMode.UNTIL_DATE && dto.endDate
        ? new Date(dto.endDate)
        : null
    this.assertEndModeConsistency(dto.endMode, endForCheck)

    await this.assertSourceOwned(userId, dto.sourceId)
    await this.assertCategoryOwned(userId, dto.categoryId)
    if (dto.categoryId) {
      await assertCategoryIsLeaf(this.prisma, userId, dto.categoryId)
    }

    const startDate = new Date(dto.startDate)
    const endDate =
      dto.endMode === RecurrenceEndMode.UNTIL_DATE && dto.endDate
        ? new Date(dto.endDate)
        : null

    if (endDate && startDate > endDate) {
      throw new BadRequestException('startDate must be on or before endDate')
    }

    return this.prisma.recurrence.create({
      data: {
        userId,
        kind: dto.kind,
        amount: new Prisma.Decimal(dto.amount.toFixed(2)),
        description: dto.description.trim(),
        sourceId: dto.sourceId ?? null,
        categoryId: dto.categoryId ?? null,
        frequency: dto.frequency,
        startDate,
        endMode: dto.endMode,
        endDate,
        active: dto.active ?? true,
      },
    })
  }

  async updateForUser(userId: string, id: string, dto: UpdateRecurrenceDto) {
    const existing = await this.findOneForUser(userId, id)

    let endMode = dto.endMode ?? existing.endMode
    let endDate: Date | null =
      dto.endDate !== undefined
        ? dto.endDate === null
          ? null
          : new Date(dto.endDate)
        : existing.endDate

    if (dto.endMode === RecurrenceEndMode.INDEFINITE) {
      endMode = RecurrenceEndMode.INDEFINITE
      endDate = null
    }

    this.assertEndModeConsistency(endMode, endDate)

    if (dto.sourceId !== undefined) {
      await this.assertSourceOwned(userId, dto.sourceId ?? undefined)
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategoryOwned(userId, dto.categoryId ?? undefined)
      if (dto.categoryId) {
        await assertCategoryIsLeaf(this.prisma, userId, dto.categoryId)
      }
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate

    if (endMode === RecurrenceEndMode.UNTIL_DATE && endDate && startDate > endDate) {
      throw new BadRequestException('startDate must be on or before endDate')
    }

    const data: Prisma.RecurrenceUpdateInput = {}
    if (dto.kind !== undefined) data.kind = dto.kind
    if (dto.amount !== undefined) {
      data.amount = new Prisma.Decimal(dto.amount.toFixed(2))
    }
    if (dto.description !== undefined) data.description = dto.description.trim()
    if (dto.frequency !== undefined) data.frequency = dto.frequency
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate)
    data.endMode = endMode
    data.endDate = endDate
    if (dto.active !== undefined) data.active = dto.active

    if (dto.sourceId !== undefined) {
      data.source =
        dto.sourceId === null
          ? { disconnect: true }
          : { connect: { id: dto.sourceId } }
    }
    if (dto.categoryId !== undefined) {
      data.category =
        dto.categoryId === null
          ? { disconnect: true }
          : { connect: { id: dto.categoryId } }
    }

    return this.prisma.recurrence.update({
      where: { id },
      data,
    })
  }

  async deleteForUser(userId: string, id: string) {
    await this.findOneForUser(userId, id)
    await this.prisma.recurrence.delete({ where: { id } })
  }

  async materializeForUser(userId: string, dto: MaterializeDto) {
    const untilEnd = endOfUtcDayFromDateString(dto.until)
    const hardCap = new Date()
    hardCap.setUTCMonth(hardCap.getUTCMonth() + MAX_HORIZON_MONTHS)

    const cap = untilEnd.getTime() < hardCap.getTime() ? untilEnd : hardCap

    const recs = dto.recurrenceId
      ? [await this.findOneForUser(userId, dto.recurrenceId)]
      : await this.prisma.recurrence.findMany({
          where: { userId, active: true },
        })

    let totalCreated = 0

    for (const rec of recs) {
      if (!rec.active) continue
      totalCreated += await this.materializeOne(rec, userId, cap)
    }

    return { created: totalCreated }
  }

  private async materializeOne(
    rec: {
      id: string
      userId: string
      kind: import('@prisma/client').TransactionKind
      amount: Prisma.Decimal
      description: string
      sourceId: string | null
      categoryId: string | null
      frequency: RecurrenceFrequency
      startDate: Date
      endMode: RecurrenceEndMode
      endDate: Date | null
    },
    userId: string,
    untilEnd: Date,
  ): Promise<number> {
    const ruleEnd =
      rec.endMode === RecurrenceEndMode.UNTIL_DATE && rec.endDate
        ? endOfUtcDayFromDateString(toUtcDateKey(rec.endDate))
        : null

    let sourceBilling: SourceBillingInput = null
    if (rec.sourceId) {
      const s = await this.prisma.source.findFirst({
        where: { id: rec.sourceId, userId },
        select: { type: true, closingDay: true, dueDay: true },
      })
      if (s) sourceBilling = s
    }

    try {
      resolveTransactionBillingFields(sourceBilling, new Date(rec.startDate))
    } catch (e) {
      if (e instanceof TransactionBillingConfigError) {
        throw new BadRequestException(e.message)
      }
      throw e
    }

    let cursor = new Date(rec.startDate)
    let created = 0
    let steps = 0

    while (cursor.getTime() <= untilEnd.getTime()) {
      if (ruleEnd && cursor.getTime() > ruleEnd.getTime()) break
      if (++steps > MAX_MATERIALIZE_STEPS) {
        throw new BadRequestException(
          'Materialization limit exceeded; narrow the date range',
        )
      }

      const fp = recurrenceTransactionFingerprint(rec.id, cursor)
      const existing = await this.prisma.transaction.findFirst({
        where: {
          userId,
          recurrenceId: rec.id,
          fingerprint: fp,
        },
        select: { id: true },
      })

      if (!existing) {
        const billing = resolveTransactionBillingFields(sourceBilling, cursor)
        await this.prisma.transaction.create({
          data: {
            userId,
            recurrenceId: rec.id,
            kind: rec.kind,
            amount: rec.amount,
            description: rec.description,
            occurredAt: cursor,
            sourceId: rec.sourceId,
            categoryId: rec.categoryId,
            fingerprint: fp,
            ...billing,
          },
        })
        created++
      }

      const next = nextOccurrence(cursor, rec.frequency)
      if (next.getTime() <= cursor.getTime()) {
        throw new BadRequestException('Invalid recurrence step')
      }
      cursor = next
    }

    return created
  }

  private assertEndModeConsistency(
    endMode: RecurrenceEndMode,
    endDate: Date | null,
  ) {
    if (endMode === RecurrenceEndMode.UNTIL_DATE && !endDate) {
      throw new BadRequestException(
        'endDate is required when endMode is UNTIL_DATE',
      )
    }
    if (endMode === RecurrenceEndMode.INDEFINITE && endDate) {
      throw new BadRequestException(
        'endDate must be empty when endMode is INDEFINITE',
      )
    }
  }

  private async assertSourceOwned(
    userId: string,
    sourceId: string | undefined,
  ) {
    if (!sourceId) return
    const s = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
    })
    if (!s) throw new BadRequestException('Invalid source')
  }

  private async assertCategoryOwned(
    userId: string,
    categoryId: string | undefined,
  ) {
    if (!categoryId) return
    const c = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
    })
    if (!c) throw new BadRequestException('Invalid category')
  }
}
