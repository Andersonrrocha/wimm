import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateCategoryDto } from './dto/create-category.dto'
import type { UpdateCategoryDto } from './dto/update-category.dto'

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForUser(userId: string) {
    return this.prisma.category.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })
  }

  async findOneForUser(userId: string, id: string) {
    const row = await this.prisma.category.findFirst({
      where: { id, userId },
    })
    if (!row) throw new NotFoundException('Category not found')
    return row
  }

  async createForUser(userId: string, dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: {
          userId,
          name: dto.name.trim(),
          type: dto.type,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this name already exists')
      }
      throw e
    }
  }

  async updateForUser(userId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOneForUser(userId, id)
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.type !== undefined && { type: dto.type }),
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this name already exists')
      }
      throw e
    }
  }

  async deleteForUser(userId: string, id: string) {
    await this.findOneForUser(userId, id)
    await this.prisma.category.delete({ where: { id } })
  }
}
