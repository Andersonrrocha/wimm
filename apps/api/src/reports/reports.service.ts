import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma, SourceType, TransactionKind } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { FutureCommitmentsQueryDto } from './dto/future-commitments-query.dto'
import type { MonthlyQueryDto } from './dto/monthly-query.dto'
import type { ReportsQueryDto } from './dto/reports-query.dto'
import {
  sumRecurrenceCommitmentsInUtcMonth,
  utcMonthBounds,
} from './future-commitments.util'

function toDecimalString(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return '0.00'
  return v.toFixed(2)
}

/**
 * Cash-flow–oriented expense filter: credit card rows (with `expectedDueDate`)
 * are placed in the interval their payment is due; everything else uses
 * `occurredAt`.  Used by summary, byCategory, and the monthly chart.
 */
function expenseWhereForDateRange(
  userId: string,
  range: { gte: Date; lte: Date },
): Prisma.TransactionWhereInput {
  return {
    userId,
    kind: TransactionKind.EXPENSE,
    OR: [
      {
        expectedDueDate: null,
        occurredAt: range,
      },
      {
        expectedDueDate: range,
      },
    ],
  }
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
    const range = this.dateRangeFilter(dto)

    const [incomeAgg, expenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, kind: TransactionKind.INCOME, occurredAt: range },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: expenseWhereForDateRange(userId, range),
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
    const range = this.dateRangeFilter(dto)

    const incomeGroups = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, kind: TransactionKind.INCOME, occurredAt: range },
      _sum: { amount: true },
    })

    const expenseGroups = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: expenseWhereForDateRange(userId, range),
      _sum: { amount: true },
    })

    const groups = [
      ...incomeGroups.map((g) => ({ ...g, kind: TransactionKind.INCOME })),
      ...expenseGroups.map((g) => ({ ...g, kind: TransactionKind.EXPENSE })),
    ]

    const categoryIds = [
      ...new Set(
        groups
          .map((g) => g.categoryId)
          .filter((id): id is string => id != null),
      ),
    ]

    const categories = await this.prisma.category.findMany({
      where: { userId, id: { in: categoryIds } },
      select: { id: true, name: true, categoryKey: true, parentId: true },
    })
    const catById = new Map(categories.map((c) => [c.id, c]))

    // Fetch parent categories for children that have a parentId.
    const parentIds = [
      ...new Set(
        categories
          .map((c) => c.parentId)
          .filter((id): id is string => id != null),
      ),
    ]
    const parents =
      parentIds.length > 0
        ? await this.prisma.category.findMany({
            where: { userId, id: { in: parentIds } },
            select: { id: true, name: true, categoryKey: true },
          })
        : []
    const parentById = new Map(parents.map((p) => [p.id, p]))

    // Roll up child categories to their parent for aggregation.
    type RollupEntry = {
      categoryId: string | null
      categoryKey: string | null
      name: string
      kind: TransactionKind
      total: Prisma.Decimal
    }
    const rollupMap = new Map<string, RollupEntry>()

    for (const g of groups) {
      const raw = new Prisma.Decimal(g._sum.amount ?? 0)
      const cat = g.categoryId ? catById.get(g.categoryId) : undefined

      let rollupId: string | null
      let rollupName: string
      let rollupKey: string | null

      if (cat?.parentId) {
        const parent = parentById.get(cat.parentId)
        rollupId = cat.parentId
        rollupName = parent?.name ?? 'Unknown category'
        rollupKey = parent?.categoryKey ?? null
      } else if (cat) {
        rollupId = cat.id
        rollupName = cat.name
        rollupKey = cat.categoryKey
      } else {
        rollupId = null
        rollupName = 'Other'
        rollupKey = null
      }

      const mapKey = `${rollupId ?? 'null'}:${g.kind}`
      const entry = rollupMap.get(mapKey)
      if (entry) {
        entry.total = entry.total.plus(raw)
      } else {
        rollupMap.set(mapKey, {
          categoryId: rollupId,
          categoryKey: rollupKey,
          name: rollupName,
          kind: g.kind,
          total: raw,
        })
      }
    }

    const items = [...rollupMap.values()].map((r) => ({
      categoryId: r.categoryId,
      categoryKey: r.categoryKey,
      name: r.name,
      kind: r.kind,
      total: toDecimalString(r.total),
    }))

    items.sort((a, b) => Number.parseFloat(b.total) - Number.parseFloat(a.total))

    return { items }
  }

  /**
   * Income, expense, and net per calendar month (UTC) for a given year.
   * Income uses occurredAt. Expenses use billing-cycle month when
   * `billingCycleMonth` and `billingCycleYear` are set (credit card).
   */
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
      const range = {
        gte: new Date(Date.UTC(year, m, 1, 0, 0, 0, 0)),
        lte: new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999)),
      }

      const [incomeAgg, expenseAgg] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: { userId, kind: TransactionKind.INCOME, occurredAt: range },
          _sum: { amount: true },
        }),
        this.prisma.transaction.aggregate({
          where: expenseWhereForDateRange(userId, range),
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

  /** Default: next UTC calendar month. */
  private resolveForecastMonth(dto: FutureCommitmentsQueryDto): {
    year: number
    month: number
  } {
    if (dto.year != null && dto.month != null) {
      return { year: dto.year, month: dto.month }
    }
    if (dto.year != null || dto.month != null) {
      throw new BadRequestException('Provide both year and month, or neither')
    }
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const d = new Date(Date.UTC(y, m + 1, 1))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
  }

  /**
   * Future cash-oriented commitments for a calendar month (UTC): recurring
   * rules (by billing/due date when on a card) and credit card installment
   * legs (by expectedDueDate, excluding recurrence-generated rows).
   */
  async futureCommitmentsForUser(userId: string, dto: FutureCommitmentsQueryDto) {
    const { year, month } = this.resolveForecastMonth(dto)
    const { monthStart, monthEnd } = utcMonthBounds(year, month)

    const recurrences = await this.prisma.recurrence.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        kind: true,
        amount: true,
        frequency: true,
        startDate: true,
        endMode: true,
        endDate: true,
        sourceId: true,
      },
    })

    const sourceIds = [
      ...new Set(
        recurrences
          .map((r) => r.sourceId)
          .filter((id): id is string => id != null),
      ),
    ]

    const sources =
      sourceIds.length === 0
        ? []
        : await this.prisma.source.findMany({
            where: { userId, id: { in: sourceIds } },
            select: { id: true, type: true, closingDay: true, dueDay: true },
          })

    const sourceBillingById = new Map(
      sources.map((s) => [
        s.id,
        {
          type: s.type,
          closingDay: s.closingDay,
          dueDay: s.dueDay,
        },
      ]),
    )

    const { recurringExpense, recurringIncome } = sumRecurrenceCommitmentsInUtcMonth(
      recurrences,
      sourceBillingById,
      year,
      month,
    )

    const cardWhere: Prisma.TransactionWhereInput = {
      userId,
      kind: TransactionKind.EXPENSE,
      recurrenceId: null,
      sourceId: { not: null },
      expectedDueDate: { gte: monthStart, lte: monthEnd },
      source: { type: SourceType.CREDIT_CARD },
      OR: [
        { isProjected: true },
        { installmentPlanId: { not: null } },
        { installmentTotal: { not: null } },
      ],
    }

    const cardAgg = await this.prisma.transaction.aggregate({
      where: cardWhere,
      _sum: { amount: true },
    })

    const cardBySource = await this.prisma.transaction.groupBy({
      by: ['sourceId'],
      where: cardWhere,
      _sum: { amount: true },
    })

    const cardSourceIds = cardBySource
      .map((g) => g.sourceId)
      .filter((id): id is string => id != null)

    const cardSources =
      cardSourceIds.length === 0
        ? []
        : await this.prisma.source.findMany({
            where: { userId, id: { in: cardSourceIds } },
            select: { id: true, name: true },
          })
    const nameById = new Map(cardSources.map((s) => [s.id, s.name]))

    const cardInstallments = new Prisma.Decimal(cardAgg._sum.amount ?? 0)
    const totalCommittedExpense = recurringExpense.plus(cardInstallments)

    return {
      year,
      month,
      recurringExpenseTotal: toDecimalString(recurringExpense),
      recurringIncomeTotal: toDecimalString(recurringIncome),
      cardInstallmentsTotal: toDecimalString(cardInstallments),
      totalCommittedExpense: toDecimalString(totalCommittedExpense),
      cardBySource: cardBySource
        .filter((g) => g.sourceId != null)
        .map((g) => ({
          sourceId: g.sourceId as string,
          sourceName: nameById.get(g.sourceId as string) ?? 'Unknown',
          total: toDecimalString(new Prisma.Decimal(g._sum.amount ?? 0)),
        }))
        .sort(
          (a, b) =>
            Number.parseFloat(b.total) - Number.parseFloat(a.total),
        ),
    }
  }
}
