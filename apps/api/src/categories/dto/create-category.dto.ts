import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
import { CategoryType } from '@wimm/shared'

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string

  @IsEnum(CategoryType)
  type!: CategoryType

  @IsOptional()
  @IsUUID()
  parentId?: string
}
