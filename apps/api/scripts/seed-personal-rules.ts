/**
 * Seeds the personal categorization rules (originally shipped as SYSTEM rules
 * but removed in migration 20260503120000) into a specific user's user-scoped
 * CategorizationRule table.
 *
 * Usage:
 *   pnpm --filter @wimm/api seed:personal -- --userId=<uuid>
 *
 * Idempotent: skips patterns that already exist for the user. Skips patterns
 * whose target categoryKey doesn't exist in the user's category tree (logs a
 * warning).
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, CategorizationMatchType } from '../src/generated/prisma/client'

type PersonalRule = {
  pattern: string
  categoryKey: string
  priority: number
}

const PERSONAL_RULES: PersonalRule[] = [
  // Personal merchants (Anderson-specific)
  { pattern: 'fort', categoryKey: 'market', priority: 2145 },
  { pattern: 'mp alimportados', categoryKey: 'shopping_other', priority: 2042 },
  { pattern: 'platano imoveis', categoryKey: 'housing', priority: 2700 },
  { pattern: 'platano imóveis', categoryKey: 'housing', priority: 2701 },
  { pattern: 'platanoimoveis', categoryKey: 'housing', priority: 2702 },
  { pattern: 'dona barbara', categoryKey: 'housing', priority: 2710 },
  { pattern: 'diagnostica', categoryKey: 'self_care', priority: 3045 },

  // Regional Rio Grande do Sul (not generic-BR)
  { pattern: 'rissul', categoryKey: 'market', priority: 2110 },
  { pattern: 'kern', categoryKey: 'market', priority: 2120 },
  { pattern: 'zaffari', categoryKey: 'market', priority: 2130 },
  { pattern: 'unidasul', categoryKey: 'market', priority: 2140 },
  { pattern: 'panvel', categoryKey: 'pharmacy', priority: 3000 },
  { pattern: 'sao joao', categoryKey: 'pharmacy', priority: 3010 },
  { pattern: 'saojoao', categoryKey: 'pharmacy', priority: 3020 },

  // Banrisul-only descriptor format
  { pattern: ' sh ', categoryKey: 'fuel', priority: 3967 },
]

function parseUserId(): string {
  const arg = process.argv.find((a) => a.startsWith('--userId='))
  if (!arg) {
    console.error('Missing --userId=<uuid>')
    console.error('Usage: pnpm --filter @wimm/api seed:personal -- --userId=<uuid>')
    process.exit(1)
  }
  return arg.split('=')[1]
}

async function main(): Promise<void> {
  const userId = parseUserId()
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      console.error(`User ${userId} not found`)
      process.exit(1)
    }

    const categories = await prisma.category.findMany({
      where: { userId, categoryKey: { not: null } },
      select: { id: true, categoryKey: true },
    })
    const idByKey = new Map<string, string>()
    for (const c of categories) {
      if (c.categoryKey) idByKey.set(c.categoryKey, c.id)
    }

    let inserted = 0
    let skippedExisting = 0
    let skippedNoCategory = 0

    for (const rule of PERSONAL_RULES) {
      const categoryId = idByKey.get(rule.categoryKey)
      if (!categoryId) {
        console.warn(
          `SKIP "${rule.pattern}": no category with key "${rule.categoryKey}" for user (run app once to seed defaults)`,
        )
        skippedNoCategory++
        continue
      }

      const existing = await prisma.categorizationRule.findFirst({
        where: { userId, pattern: rule.pattern },
        select: { id: true },
      })
      if (existing) {
        console.log(`SKIP "${rule.pattern}": already exists for user`)
        skippedExisting++
        continue
      }

      await prisma.categorizationRule.create({
        data: {
          userId,
          pattern: rule.pattern,
          categoryId,
          matchType: CategorizationMatchType.CONTAINS,
          priority: rule.priority,
          active: true,
        },
      })
      console.log(`OK   "${rule.pattern}" -> ${rule.categoryKey}`)
      inserted++
    }

    console.log(
      `\nDone. Inserted: ${inserted}. Skipped (existing): ${skippedExisting}. Skipped (no category): ${skippedNoCategory}.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
