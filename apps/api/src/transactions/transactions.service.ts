import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { BulkCategorizeDto } from './dto/bulk-categorize.dto'
import type { CreateTransactionDto } from './dto/create-transaction.dto'
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto'
import type { UpdateTransactionDto } from './dto/update-transaction.dto'

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, query: ListTransactionsQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: Prisma.TransactionWhereInput = { userId }
    if (query.categoryId) where.categoryId = query.categoryId
    if (query.sourceId) where.sourceId = query.sourceId

    const occurredAt: Prisma.DateTimeFilter = {}
    if (query.from) occurredAt.gte = new Date(query.from)
    if (query.to) occurredAt.lte = new Date(query.to)
    if (Object.keys(occurredAt).length > 0) {
      where.occurredAt = occurredAt
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async findOneForUser(userId: string, id: string) {
    const row = await this.prisma.transaction.findFirst({
      where: { id, userId },
    })
    if (!row) throw new NotFoundException('Transaction not found')
    return row
  }

  async createForUser(userId: string, dto: CreateTransactionDto) {
    await this.assertSourceOwned(userId, dto.sourceId)
    await this.assertCategoryOwned(userId, dto.categoryId)

    return this.prisma.transaction.create({
      data: {
        userId,
        kind: dto.kind,
        amount: new Prisma.Decimal(dto.amount),
        description: dto.description.trim(),
        occurredAt: new Date(dto.occurredAt),
        sourceId: dto.sourceId ?? null,
        categoryId: dto.categoryId ?? null,
      },
    })
  }

  async updateForUser(userId: string, id: string, dto: UpdateTransactionDto) {
    await this.findOneForUser(userId, id)
    if (dto.sourceId != null) {
      await this.assertSourceOwned(userId, dto.sourceId)
    }
    if (dto.categoryId != null) {
      await this.assertCategoryOwned(userId, dto.categoryId)
    }

    const data: Prisma.TransactionUpdateInput = {}
    if (dto.kind !== undefined) data.kind = dto.kind
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount)
    if (dto.description !== undefined) data.description = dto.description.trim()
    if (dto.occurredAt !== undefined) data.occurredAt = new Date(dto.occurredAt)
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

    return this.prisma.transaction.update({
      where: { id },
      data,
    })
  }

  async deleteForUser(userId: string, id: string) {
    await this.findOneForUser(userId, id)
    await this.prisma.transaction.delete({ where: { id } })
  }

  async bulkCategorizeForUser(userId: string, dto: BulkCategorizeDto) {
    await this.assertCategoryOwned(userId, dto.categoryId)

    const result = await this.prisma.transaction.updateMany({
      where: {
        userId,
        id: { in: dto.transactionIds },
      },
      data: { categoryId: dto.categoryId },
    })

    return { updated: result.count }
  }

  private async assertSourceOwned(userId: string, sourceId: string | undefined) {
    if (!sourceId) return
    const s = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
    })
    if (!s) throw new BadRequestException('Invalid source')
  }

  private async assertCategoryOwned(userId: string, categoryId: string | undefined) {
    if (!categoryId) return
    const c = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
    })
    if (!c) throw new BadRequestException('Invalid category')
  }
}
