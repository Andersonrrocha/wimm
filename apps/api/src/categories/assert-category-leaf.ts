import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Ensures the given category is a leaf (has no children) before allowing a
 * transaction, recurrence, or rule to reference it.  Parent categories that
 * have subcategories must not be assigned directly.
 */
export async function assertCategoryIsLeaf(
  prisma: PrismaService,
  userId: string,
  categoryId: string,
): Promise<void> {
  const childCount = await prisma.category.count({
    where: { userId, parentId: categoryId },
  })
  if (childCount > 0) {
    throw new BadRequestException(
      'This category has subcategories and cannot be assigned directly. Please select a subcategory.',
    )
  }
}
