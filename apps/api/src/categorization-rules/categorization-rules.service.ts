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
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateCategorizationRuleDto } from './dto/create-categorization-rule.dto'
import type { UpdateCategorizationRuleDto } from './dto/update-categorization-rule.dto'

export type RuleWithCategory = CategorizationRule & {
  category: Category
}

@Injectable()
export class CategorizationRulesService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Load active rules with categories, ordered for evaluation. */
  async loadActiveRulesWithCategories(
    userId: string,
  ): Promise<RuleWithCategory[]> {
    return this.prisma.categorizationRule.findMany({
      where: { userId, active: true },
      include: { category: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
  }

  /**
   * First matching rule wins. Category type must match transaction kind
   * (INCOME vs EXPENSE).
   */
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
