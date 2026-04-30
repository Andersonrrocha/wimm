import {
  BadRequestException,
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
      include: {
        parent: { select: { id: true, name: true, categoryKey: true } },
      },
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
    if (dto.parentId) {
      await this.assertValidParent(userId, dto.parentId)
    }
    try {
      return await this.prisma.category.create({
        data: {
          userId,
          name: dto.name.trim(),
          type: dto.type,
          parentId: dto.parentId ?? null,
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
    if (dto.parentId !== undefined && dto.parentId !== null) {
      await this.assertValidParent(userId, dto.parentId)
    }
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId ?? null }),
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
    const childCount = await this.prisma.category.count({
      where: { userId, parentId: id },
    })
    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that has subcategories. Delete the subcategories first.',
      )
    }
    await this.prisma.category.delete({ where: { id } })
  }

  /** Parent must exist, belong to user, and must itself be a top-level category (depth 1). */
  private async assertValidParent(userId: string, parentId: string) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, userId },
      select: { parentId: true },
    })
    if (!parent) throw new BadRequestException('Invalid parent category')
    if (parent.parentId !== null) {
      throw new BadRequestException(
        'Maximum category depth is 2. The selected parent is already a subcategory.',
      )
    }
  }
}
