/**
 * Grants a user the lifetime Founder slot. Founder numbers run 1..200; the
 * commercial paywall sprint will gate this slot count visibly. Friends-test
 * users get founder slots via this CLI without consuming the cap, by passing
 * a number above 200 if needed.
 *
 * Usage:
 *   pnpm --filter @wimm/api exec tsx scripts/grant-founder.ts \
 *     --userId=<uuid> --founderNumber=42
 *
 * Idempotent: re-running with the same userId and number is a no-op. Re-running
 * with a different number reassigns. Conflict on number returns an error so
 * we never silently overwrite someone else's slot.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  PrismaClient,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../src/generated/prisma/client'

function parseArg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

async function main(): Promise<void> {
  const userId = parseArg('userId')
  const founderRaw = parseArg('founderNumber')
  if (!userId || !founderRaw) {
    console.error('Usage: grant-founder --userId=<uuid> --founderNumber=<int>')
    process.exit(1)
  }
  const founderNumber = Number.parseInt(founderRaw, 10)
  if (!Number.isInteger(founderNumber) || founderNumber < 1) {
    console.error(`Invalid --founderNumber: ${founderRaw}`)
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, founderNumber: true },
    })
    if (!user) {
      console.error(`User ${userId} not found`)
      process.exit(1)
    }

    if (user.founderNumber === founderNumber) {
      console.log(
        `User ${user.email} is already Founder #${founderNumber}. No change.`,
      )
      return
    }

    const conflict = await prisma.user.findUnique({
      where: { founderNumber },
      select: { id: true, email: true },
    })
    if (conflict && conflict.id !== userId) {
      console.error(
        `Founder #${founderNumber} is already held by ${conflict.email}. Pick another number.`,
      )
      process.exit(1)
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        founderNumber,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionPlan: SubscriptionPlan.LIFETIME,
      },
    })

    console.log(
      `Granted Founder #${founderNumber} (LIFETIME) to ${user.email}.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
