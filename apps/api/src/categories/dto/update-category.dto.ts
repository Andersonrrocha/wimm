import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { CategoryType } from '@prisma/client'

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string

  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType
}
