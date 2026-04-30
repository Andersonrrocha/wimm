import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  CategoryType,
  Prisma,
  TransactionKind,
  type CategorizationRule,
  type Category,
  type SystemCategorizationRule,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { assertCategoryIsLeaf } from '../categories/assert-category-leaf'
import { resolveFirstSystemCategoryId } from './resolve-system-category'
import type { CreateCategorizationRuleDto } from './dto/create-categorization-rule.dto'
import type { UpdateCategorizationRuleDto } from './dto/update-categorization-rule.dto'

export type RuleWithCategory = CategorizationRule & {
  category: Category
}

export type SystemResolutionContext = {
  systemRules: SystemCategorizationRule[]
  categoryIdByKey: Map<string, string>
}

@Injectable()
export class CategorizationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCategories: DefaultCategoriesService,
  ) {}

  async listForUser(userId: string) {
    return this.prisma.categorizationRule.findMany({
      where: { userId },
      include: { category: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
  }

  async findOneForUser(userId: string, id: string) {
    const row = await this.prisma.categorizationRule.findFirst({
      where: { id, userId },
      include: { category: true },
    })
    if (!row) throw new NotFoundException('Rule not found')
    return row
  }

  async createForUser(userId: string, dto: CreateCategorizationRuleDto) {
    await this.assertCategoryOwned(userId, dto.categoryId)
    await assertCategoryIsLeaf(this.prisma, userId, dto.categoryId)

    return this.prisma.categorizationRule.create({
      data: {
        userId,
        priority: dto.priority,
        matchType: dto.matchType,
        pattern: dto.pattern.trim(),
        categoryId: dto.categoryId,
        active: dto.active ?? true,
      },
      include: { category: true },
    })
  }

  async updateForUser(
    userId: string,
    id: string,
    dto: UpdateCategorizationRuleDto,
  ) {
    await this.findOneForUser(userId, id)
    if (dto.categoryId) {
      await this.assertCategoryOwned(userId, dto.categoryId)
      await assertCategoryIsLeaf(this.prisma, userId, dto.categoryId)
    }

    const data: Prisma.CategorizationRuleUpdateInput = {}
    if (dto.priority !== undefined) data.priority = dto.priority
    if (dto.matchType !== undefined) data.matchType = dto.matchType
    if (dto.pattern !== undefined) data.pattern = dto.pattern.trim()
    if (dto.active !== undefined) data.active = dto.active
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } }
    }

    return this.prisma.categorizationRule.update({
      where: { id },
      data,
      include: { category: true },
    })
  }

  async deleteForUser(userId: string, id: string) {
    await this.findOneForUser(userId, id)
    await this.prisma.categorizationRule.delete({ where: { id } })
  }

  async loadActiveRulesWithCategories(
    userId: string,
  ): Promise<RuleWithCategory[]> {
    return this.prisma.categorizationRule.findMany({
      where: { userId, active: true },
      include: { category: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
  }

  /** Active global system rules, ordered for evaluation (bootstrap after user rules). */
  async loadActiveSystemRulesOrdered(): Promise<SystemCategorizationRule[]> {
    return this.prisma.systemCategorizationRule.findMany({
      where: { active: true },
      orderBy: [{ priority: 'asc' }, { pattern: 'asc' }],
    })
  }

  /**
   * Maps stable categoryKey → id for resolving system rules.
   * Only leaf categories (no children) are included: transactions and rules
   * must target leaves; parent keys like `health` or `online_shopping` must
   * not resolve to a non-assignable row.
   */
  async buildCategoryIdByKeyMap(userId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({
      where: { userId, categoryKey: { not: null } },
      select: {
        id: true,
        categoryKey: true,
        _count: { select: { children: true } },
      },
    })
    const m = new Map<string, string>()
    for (const r of rows) {
      if (r.categoryKey && r._count.children === 0) {
        m.set(r.categoryKey, r.id)
      }
    }
    return m
  }

  async loadSystemResolutionContext(
    userId: string,
  ): Promise<SystemResolutionContext> {
    await this.defaultCategories.ensureForUser(userId)
    const [systemRules, categoryIdByKey] = await Promise.all([
      this.loadActiveSystemRulesOrdered(),
      this.buildCategoryIdByKeyMap(userId),
    ])
    return { systemRules, categoryIdByKey }
  }

  resolveCategoryIdWithSystem(
    kind: TransactionKind,
    description: string,
    userRules: RuleWithCategory[],
    ctx: SystemResolutionContext,
  ): string | null {
    const fromUser = this.resolveCategoryId(kind, description, userRules)
    if (fromUser) return fromUser
    const normDesc = description.trim().toLowerCase()
    return resolveFirstSystemCategoryId(
      kind,
      normDesc,
      ctx.systemRules,
      ctx.categoryIdByKey,
    )
  }

  resolveCategoryId(
    kind: TransactionKind,
    description: string,
    rules: RuleWithCategory[],
  ): string | null {
    const normDesc = description.trim().toLowerCase()
    const expectedCatType =
      kind === TransactionKind.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE

    for (const rule of rules) {
      if (rule.category.type !== expectedCatType) continue
      const p = rule.pattern.trim().toLowerCase()
      if (!p) continue
      const hit =
        rule.matchType === 'EQUALS'
          ? normDesc === p
          : normDesc.includes(p)
      if (hit) return rule.categoryId
    }
    return null
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const c = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
    })
    if (!c) throw new BadRequestException('Invalid category')
  }
}
