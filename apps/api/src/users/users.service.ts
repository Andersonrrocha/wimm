import { Injectable, NotFoundException } from '@nestjs/common'
import {
  AiCategorizationMode,
  ChartDateMode,
  Prisma,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { UpdateMeDto } from './dto/update-me.dto'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!user) {
      throw new NotFoundException('User not found')
    }
    return user
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
