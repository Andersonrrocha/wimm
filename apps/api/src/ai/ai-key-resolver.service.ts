import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiCategorizationMode } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Resolves the Anthropic API key to use for a given user.
 *
 * Returns null when:
 *   - the user is OFF
 *   - `ANTHROPIC_API_KEY` is unset on the server
 *
 * Callers treat null as "skip AI for this request" — never throw on the
 * import path. AI is advisory; missing keys must not block previews.
 */
@Injectable()
export class AiKeyResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolveForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { aiCategorizationMode: true },
    })
    if (!user) return null
    if (user.aiCategorizationMode !== AiCategorizationMode.ON) return null

    // TODO(paywall): require an active paid subscription before the env key
    // is handed out. Until then every ON user shares Anderson's key.
    return this.config.get<string>('ANTHROPIC_API_KEY') ?? null
  }
}
