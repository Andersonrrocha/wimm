import { Injectable } from '@nestjs/common'
import { CategoryType, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export const DEFAULT_CATEGORY_KEYS = [
  'streaming',
  'online_shopping',
  'market',
  'health',
  'transport',
  'utilities',
] as const

export type DefaultCategoryKey = (typeof DEFAULT_CATEGORY_KEYS)[number]

const LABELS: Record<
  'en' | 'pt',
  Record<DefaultCategoryKey, string>
> = {
  pt: {
    streaming: 'Streaming',
    online_shopping: 'Compras online',
    market: 'Mercado',
    health: 'Saúde',
    transport: 'Transporte',
    utilities: 'Contas e utilidades',
  },
  en: {
    streaming: 'Streaming',
    online_shopping: 'Online shopping',
    market: 'Market',
    health: 'Health',
    transport: 'Transport',
    utilities: 'Bills & utilities',
  },
}

@Injectable()
export class DefaultCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    })
    const loc = user?.preferredLocale === 'en' ? 'en' : 'pt'
    const labels = LABELS[loc]

    for (const key of DEFAULT_CATEGORY_KEYS) {
      const existing = await this.prisma.category.findFirst({
        where: { userId, categoryKey: key },
      })
      if (existing) continue

      const sameName = await this.prisma.category.findFirst({
        where: { userId, name: labels[key] },
      })
      if (sameName && sameName.categoryKey == null) {
        await this.prisma.category.update({
          where: { id: sameName.id },
          data: { categoryKey: key },
        })
        continue
      }

      try {
        await this.prisma.category.create({
          data: {
            userId,
            categoryKey: key,
            name: labels[key],
            type: CategoryType.EXPENSE,
          },
        })
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue
        }
        throw e
      }
    }
  }
}
