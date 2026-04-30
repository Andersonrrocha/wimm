import { Injectable } from '@nestjs/common'
import { CategoryType, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type CategoryNode = {
  categoryKey: string
  parentKey: string | null
  type: CategoryType
  labels: { en: string; pt: string }
}

/**
 * Declarative 2-level category tree.
 * Rules:
 * - Parents (parentKey = null) are listed first.
 * - A parent only has children if there is a real split (>1 specific subcategory).
 * - We never seed a parent whose only child would be a generic `_other`.
 * - `other` is a top-level leaf (global fallback for unclassified expenses).
 */
export const CATEGORY_TREE: CategoryNode[] = [
  // ── Top-level parents (will have children) ──────────────────────────────
  { categoryKey: 'food',            parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Food',              pt: 'Alimentação'          } },
  { categoryKey: 'transport',       parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Transport',         pt: 'Transporte'           } },
  { categoryKey: 'health',          parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Health',            pt: 'Saúde'                } },
  { categoryKey: 'subscriptions',   parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Subscriptions',     pt: 'Assinaturas'          } },
  { categoryKey: 'online_shopping', parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Online shopping',   pt: 'Compras online'       } },
  { categoryKey: 'debts',           parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Debts',             pt: 'Débitos'              } },

  // ── Top-level leaves (no children) ──────────────────────────────────────
  { categoryKey: 'housing',       parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Housing',         pt: 'Moradia'             } },
  { categoryKey: 'leisure',       parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Leisure',         pt: 'Lazer'               } },
  { categoryKey: 'taxes',         parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Taxes',           pt: 'Impostos'            } },
  { categoryKey: 'utilities',     parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Bills & utilities', pt: 'Contas e utilidades' } },
  { categoryKey: 'other',         parentKey: null, type: CategoryType.EXPENSE, labels: { en: 'Other',           pt: 'Outros'              } },

  // ── Children of food ────────────────────────────────────────────────────
  { categoryKey: 'market',        parentKey: 'food', type: CategoryType.EXPENSE, labels: { en: 'Market',       pt: 'Mercado'              } },
  { categoryKey: 'restaurants',   parentKey: 'food', type: CategoryType.EXPENSE, labels: { en: 'Restaurants',  pt: 'Restaurantes'         } },
  { categoryKey: 'food_other',    parentKey: 'food', type: CategoryType.EXPENSE, labels: { en: 'Food — Other', pt: 'Alimentação — Outros'  } },

  // ── Children of transport ────────────────────────────────────────────────
  { categoryKey: 'fuel',              parentKey: 'transport', type: CategoryType.EXPENSE, labels: { en: 'Fuel',              pt: 'Combustível'         } },
  { categoryKey: 'public_transport',  parentKey: 'transport', type: CategoryType.EXPENSE, labels: { en: 'Public transport',  pt: 'Transporte público'  } },
  { categoryKey: 'maintenance',       parentKey: 'transport', type: CategoryType.EXPENSE, labels: { en: 'Maintenance',       pt: 'Manutenção'          } },
  { categoryKey: 'transport_other',   parentKey: 'transport', type: CategoryType.EXPENSE, labels: { en: 'Transport — Other', pt: 'Transporte — Outros' } },

  // ── Children of health ───────────────────────────────────────────────────
  { categoryKey: 'pharmacy',     parentKey: 'health', type: CategoryType.EXPENSE, labels: { en: 'Pharmacy',       pt: 'Farmácia'        } },
  { categoryKey: 'self_care',    parentKey: 'health', type: CategoryType.EXPENSE, labels: { en: 'Self-care',      pt: 'Auto cuidado'    } },
  { categoryKey: 'health_other', parentKey: 'health', type: CategoryType.EXPENSE, labels: { en: 'Health — Other', pt: 'Saúde — Outros'  } },

  // ── Children of online_shopping ─────────────────────────────────────────
  { categoryKey: 'shopping_clothing', parentKey: 'online_shopping', type: CategoryType.EXPENSE, labels: { en: 'Apparel',                  pt: 'Vestuário'               } },
  { categoryKey: 'shopping_games',    parentKey: 'online_shopping', type: CategoryType.EXPENSE, labels: { en: 'Games',                    pt: 'Jogos'                   } },
  { categoryKey: 'shopping_home',     parentKey: 'online_shopping', type: CategoryType.EXPENSE, labels: { en: 'Home',                     pt: 'Casa'                    } },
  { categoryKey: 'shopping_other',    parentKey: 'online_shopping', type: CategoryType.EXPENSE, labels: { en: 'Online shopping — Other',  pt: 'Compras online — Outros' } },

  // ── Children of subscriptions ────────────────────────────────────────────
  { categoryKey: 'streaming',            parentKey: 'subscriptions', type: CategoryType.EXPENSE, labels: { en: 'Streaming',              pt: 'Streaming'              } },
  { categoryKey: 'software',             parentKey: 'subscriptions', type: CategoryType.EXPENSE, labels: { en: 'Software',               pt: 'Software'               } },
  { categoryKey: 'subscriptions_other',  parentKey: 'subscriptions', type: CategoryType.EXPENSE, labels: { en: 'Subscriptions — Other',  pt: 'Assinaturas — Outros'   } },

  // ── Children of debts ───────────────────────────────────────────────────
  { categoryKey: 'debt_loans',       parentKey: 'debts', type: CategoryType.EXPENSE, labels: { en: 'Loans',        pt: 'Empréstimos' } },
  { categoryKey: 'debt_cards',       parentKey: 'debts', type: CategoryType.EXPENSE, labels: { en: 'Credit cards', pt: 'Cartões'       } },
  { categoryKey: 'debt_car',         parentKey: 'debts', type: CategoryType.EXPENSE, labels: { en: 'Car',          pt: 'Carro'         } },
  { categoryKey: 'debt_motorcycle',  parentKey: 'debts', type: CategoryType.EXPENSE, labels: { en: 'Motorcycle',   pt: 'Moto'          } },
]

export type DefaultCategoryKey = (typeof CATEGORY_TREE)[number]['categoryKey']

@Injectable()
export class DefaultCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: creates the full 2-level tree for the user if not yet present,
   * and heals parentId links for categories that may have been created by an
   * earlier flat seed.
   */
  async ensureForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    })
    const loc = user?.preferredLocale === 'en' ? 'en' : 'pt'

    // Load all existing categories for this user keyed by categoryKey.
    const existing = await this.prisma.category.findMany({
      where: { userId, categoryKey: { not: null } },
      select: { id: true, categoryKey: true, parentId: true },
    })
    const byKey = new Map(
      existing.map((c) => [
        c.categoryKey!,
        { id: c.id, categoryKey: c.categoryKey!, parentId: c.parentId },
      ]),
    )

    // Pass 1: ensure all top-level categories exist.
    for (const node of CATEGORY_TREE.filter((n) => n.parentKey === null)) {
      await this.upsertNode(userId, node, loc, null, byKey)
    }

    // Pass 2: ensure all child categories exist and are linked to their parent.
    for (const node of CATEGORY_TREE.filter((n) => n.parentKey !== null)) {
      const parent = byKey.get(node.parentKey!)
      if (!parent) continue // parent creation failed or was skipped; skip child too
      await this.upsertNode(userId, node, loc, parent.id, byKey)
    }
  }

  private async upsertNode(
    userId: string,
    node: CategoryNode,
    loc: 'en' | 'pt',
    parentId: string | null,
    byKey: Map<string, { id: string; categoryKey: string; parentId: string | null }>,
  ): Promise<void> {
    const label = node.labels[loc]
    const existing = byKey.get(node.categoryKey)

    if (existing) {
      // Heal: update parentId if it doesn't match expected
      if (existing.parentId !== parentId) {
        await this.prisma.category.update({
          where: { id: existing.id },
          data: { parentId },
        })
        existing.parentId = parentId
      }
      return
    }

    // Check if a category with the same name exists but no key (legacy).
    const sameName = await this.prisma.category.findFirst({
      where: { userId, name: label },
      select: { id: true, categoryKey: true, parentId: true },
    })
    if (sameName && sameName.categoryKey == null) {
      await this.prisma.category.update({
        where: { id: sameName.id },
        data: { categoryKey: node.categoryKey, parentId },
      })
      byKey.set(node.categoryKey, {
        id: sameName.id,
        categoryKey: node.categoryKey,
        parentId,
      })
      return
    }

    try {
      const created = await this.prisma.category.create({
        data: {
          userId,
          categoryKey: node.categoryKey,
          name: label,
          type: node.type,
          parentId,
        },
      })
      byKey.set(node.categoryKey, {
        id: created.id,
        categoryKey: node.categoryKey,
        parentId,
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Conflict (name or key already taken); re-fetch and register in map.
        const row = await this.prisma.category.findFirst({
          where: { userId, categoryKey: node.categoryKey },
          select: { id: true, categoryKey: true, parentId: true },
        })
        if (row) {
          byKey.set(node.categoryKey, {
            id: row.id,
            categoryKey: row.categoryKey!,
            parentId: row.parentId,
          })
        }
        return
      }
      throw e
    }
  }
}
