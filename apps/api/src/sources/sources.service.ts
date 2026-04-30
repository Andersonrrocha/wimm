import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, SourceType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateSourceDto } from './dto/create-source.dto'
import type { UpdateSourceDto } from './dto/update-source.dto'

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertCreditCardBillingDays(
    closingDay: number | null | undefined,
    dueDay: number | null | undefined,
  ): void {
    if (
      closingDay == null ||
      dueDay == null ||
      closingDay < 1 ||
      closingDay > 31 ||
      dueDay < 1 ||
      dueDay > 31
    ) {
      throw new BadRequestException(
        'Credit card sources require closingDay and dueDay between 1 and 31.',
      )
    }
  }

  findAllForUser(userId: string) {
    return this.prisma.source.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })
  }

  async findOneForUser(userId: string, id: string) {
    const row = await this.prisma.source.findFirst({
      where: { id, userId },
    })
    if (!row) throw new NotFoundException('Source not found')
    return row
  }

  async createForUser(userId: string, dto: CreateSourceDto) {
    if (dto.type === SourceType.CREDIT_CARD) {
      this.assertCreditCardBillingDays(dto.closingDay, dto.dueDay)
    } else if (dto.closingDay != null || dto.dueDay != null) {
      throw new BadRequestException(
        'closingDay and dueDay are only allowed for credit card sources.',
      )
    }

    try {
      return await this.prisma.source.create({
        data: {
          userId,
          name: dto.name.trim(),
          type: dto.type,
          closingDay:
            dto.type === SourceType.CREDIT_CARD ? dto.closingDay! : null,
          dueDay: dto.type === SourceType.CREDIT_CARD ? dto.dueDay! : null,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A source with this name already exists')
      }
      throw e
    }
  }

  async updateForUser(userId: string, id: string, dto: UpdateSourceDto) {
    const existing = await this.findOneForUser(userId, id)
    const nextType = dto.type ?? existing.type
    const nextName = dto.name !== undefined ? dto.name.trim() : existing.name

    let closingDay: number | null = existing.closingDay
    let dueDay: number | null = existing.dueDay

    const billingTouched =
      dto.closingDay !== undefined ||
      dto.dueDay !== undefined ||
      dto.type !== undefined

    if (billingTouched) {
      if (nextType === SourceType.CREDIT_CARD) {
        const c =
          dto.closingDay !== undefined ? dto.closingDay : existing.closingDay
        const d = dto.dueDay !== undefined ? dto.dueDay : existing.dueDay
        this.assertCreditCardBillingDays(c, d)
        closingDay = c
        dueDay = d
      } else {
        if (dto.closingDay !== undefined || dto.dueDay !== undefined) {
          throw new BadRequestException(
            'closingDay and dueDay are only allowed for credit card sources.',
          )
        }
        closingDay = null
        dueDay = null
      }
    }

    try {
      return await this.prisma.source.update({
        where: { id },
        data: {
          name: nextName,
          type: nextType,
          closingDay,
          dueDay,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A source with this name already exists')
      }
      throw e
    }
  }

  async deleteForUser(userId: string, id: string) {
    await this.findOneForUser(userId, id)
    await this.prisma.source.delete({ where: { id } })
  }
}
