import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma, TransactionKind } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { MonthlyQueryDto } from './dto/monthly-query.dto'
import type { ReportsQueryDto } from './dto/reports-query.dto'

function toDecimalString(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return '0.00'
  return v.toFixed(2)
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRangeFilter(dto: ReportsQueryDto): { gte: Date; lte: Date } {
    const from = new Date(dto.from)
    const to = new Date(dto.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range')
    }
    if (from > to) {
      throw new BadRequestException('"from" must be before or equal to "to"')
    }
    const toEnd = new Date(to)
    toEnd.setUTCHours(23, 59, 59, 999)
    return { gte: from, lte: toEnd }
  }

  async summaryForUser(userId: string, dto: ReportsQueryDto) {
    const occurredAt = this.dateRangeFilter(dto)

    const whereBase: Prisma.TransactionWhereInput = {
      userId,
      occurredAt,
    }

    const [incomeAgg, expenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...whereBase, kind: TransactionKind.INCOME },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...whereBase, kind: TransactionKind.EXPENSE },
        _sum: { amount: true },
      }),
    ])

    const income = new Prisma.Decimal(incomeAgg._sum.amount ?? 0)
    const expense = new Prisma.Decimal(expenseAgg._sum.amount ?? 0)
    const net = income.minus(expense)

    return {
      income: toDecimalString(income),
      expense: toDecimalString(expense),
      net: toDecimalString(net),
    }
  }

  async byCategoryForUser(userId: string, dto: ReportsQueryDto) {
    const occurredAt = this.dateRangeFilter(dto)

    const groups = await this.prisma.transaction.groupBy({
      by: ['categoryId', 'kind'],
      where: {
        userId,
        occurredAt,
      },
      _sum: {
        amount: true,
      },
    })

    const categoryIds = [
      ...new Set(
        groups
          .map((g) => g.categoryId)
          .filter((id): id is string => id != null),
      ),
    ]

    const categories = await this.prisma.category.findMany({
      where: { userId, id: { in: categoryIds } },
      select: { id: true, name: true, categoryKey: true },
    })
    const catById = new Map(categories.map((c) => [c.id, c]))

    const items = groups.map((g) => {
      const total = new Prisma.Decimal(g._sum.amount ?? 0)
      const cat = g.categoryId ? catById.get(g.categoryId) : undefined
      const name =
        g.categoryId == null
          ? 'Uncategorized'
          : (cat?.name ?? 'Unknown category')
      return {
        categoryId: g.categoryId,
        categoryKey: cat?.categoryKey ?? null,
        name,
        kind: g.kind,
        total: toDecimalString(total),
      }
    })

    items.sort((a, b) => Number.parseFloat(b.total) - Number.parseFloat(a.total))

    return { items }
  }

  /** Income, expense, and net per calendar month (UTC) for a given year. */
  async monthlyForUser(userId: string, dto: MonthlyQueryDto) {
    const year = dto.year
    const monthLabels = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]

    const months: Array<{
      month: number
      label: string
      income: string
      expense: string
      net: string
    }> = []

    for (let m = 0; m < 12; m++) {
      const gte = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0))
      const lte = new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999))
      const occurredAt = { gte, lte }
      const whereBase: Prisma.TransactionWhereInput = {
        userId,
        occurredAt,
      }

      const [incomeAgg, expenseAgg] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: { ...whereBase, kind: TransactionKind.INCOME },
          _sum: { amount: true },
        }),
        this.prisma.transaction.aggregate({
          where: { ...whereBase, kind: TransactionKind.EXPENSE },
          _sum: { amount: true },
        }),
      ])

      const income = new Prisma.Decimal(incomeAgg._sum.amount ?? 0)
      const expense = new Prisma.Decimal(expenseAgg._sum.amount ?? 0)
      const net = income.minus(expense)

      months.push({
        month: m + 1,
        label: monthLabels[m] ?? String(m + 1),
        income: toDecimalString(income),
        expense: toDecimalString(expense),
        net: toDecimalString(net),
      })
    }

    return { year, months }
  }
}
