import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AiByokSource, AiCategorizationMode, ChartDateMode } from '@wimm/shared'
import { AiKeyCrypto } from '../ai/ai-key-crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { UpdateMeDto } from './dto/update-me.dto'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiKeyCrypto: AiKeyCrypto,
  ) {}

  async findByIdOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        preferredLocale: true,
        chartDateMode: true,
        onboardedAt: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        trialEndsAt: true,
        founderNumber: true,
        aiCategorizationMode: true,
        aiByokSource: true,
        aiApiKeyEncrypted: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!user) {
      throw new NotFoundException('User not found')
    }
    // Never leak the encrypted key. Surface a boolean so the UI can show
    // "key configured" without revealing the value.
    //
    // **Usable, not merely present.** `AiKeyCrypto.canDecrypt` is the same
    // question `AiKeyResolverService.resolveForUser` asks, which is what
    // decides whether the Anthropic provider offers a credential at all. A
    // bare `!== null` answered a different question, and the two diverge for
    // a stored-but-undecryptable key: the renderer then showed the BYOK
    // credential chooser and said no suggestion would be made until a source
    // was picked, while the backend had seen one source all along and was
    // already using the ChatGPT plan. The remedy for this user is to paste
    // the key again, which is exactly what the "no key" branch of the
    // settings UI offers -- see `AiKeyCrypto.canDecrypt` for the full note.
    const { aiApiKeyEncrypted, ...rest } = user
    return {
      ...rest,
      hasAiApiKey:
        aiApiKeyEncrypted !== null && this.aiKeyCrypto.canDecrypt(aiApiKeyEncrypted),
    }
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const data: Prisma.UserUpdateInput = {}
    if (dto.preferredLocale !== undefined) {
      data.preferredLocale = dto.preferredLocale
    }
    if (dto.chartDateMode !== undefined) {
      data.chartDateMode = dto.chartDateMode as ChartDateMode
    }
    if (dto.aiCategorizationMode !== undefined) {
      data.aiCategorizationMode =
        dto.aiCategorizationMode as AiCategorizationMode
    }
    // Asymmetric, like `aiApiKey` below: a value chooses, `null` clears the
    // choice back to "not chosen", `undefined` leaves the stored one alone.
    if (dto.aiByokSource !== undefined) {
      data.aiByokSource = dto.aiByokSource as AiByokSource | null
    }
    if (dto.aiApiKey !== undefined) {
      data.aiApiKeyEncrypted =
        dto.aiApiKey === null ? null : this.aiKeyCrypto.encrypt(dto.aiApiKey)
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      })
    }
    return this.findByIdOrThrow(userId)
  }

  async markOnboarded(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardedAt: new Date() },
    })
    return this.findByIdOrThrow(userId)
  }
}
