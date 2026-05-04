import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiCategorizationMode } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AiKeyCrypto } from './ai-key-crypto'

/**
 * Resolves the Anthropic API key to use for a given user. Returns null when
 * the user is OFF or when the configured mode lacks a usable key (e.g. BYOK
 * without a stored key, or SERVER without ANTHROPIC_API_KEY in env). Callers
 * treat null as "skip AI for this request" — never throw on the import path.
 */
@Injectable()
export class AiKeyResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: AiKeyCrypto,
  ) {}

  async resolveForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiCategorizationMode: true,
        aiApiKeyEncrypted: true,
      },
    })
    if (!user) return null

    // TODO(paywall): SERVER mode requires
    //   subscriptionStatus === 'ACTIVE' && plan in (MONTHLY|ANNUAL|LIFETIME)
    // when the paywall sprint lands. BYOK stays free as the privacy escape.
    if (user.aiCategorizationMode === AiCategorizationMode.SERVER) {
      const serverKey = this.config.get<string>('ANTHROPIC_API_KEY')
      return serverKey ?? null
    }

    if (user.aiCategorizationMode === AiCategorizationMode.BYOK) {
      if (!user.aiApiKeyEncrypted) return null
      try {
        return this.crypto.decrypt(user.aiApiKeyEncrypted)
      } catch {
        // Likely the encryption secret was rotated. Treat as no key — the
        // user will see no AI badges and can re-paste in settings.
        return null
      }
    }

    return null
  }
}
