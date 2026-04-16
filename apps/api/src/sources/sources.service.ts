import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateSourceDto } from './dto/create-source.dto'
import type { UpdateSourceDto } from './dto/update-source.dto'

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

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
    try {
      return await this.prisma.source.create({
        data: {
          userId,
          name: dto.name.trim(),
          type: dto.type,
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
    await this.findOneForUser(userId, id)
    try {
      return await this.prisma.source.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.type !== undefined && { type: dto.type }),
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
