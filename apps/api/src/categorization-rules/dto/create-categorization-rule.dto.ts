import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { CategorizationMatchType } from '@prisma/client'

export class CreateCategorizationRuleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority!: number

  @IsEnum(CategorizationMatchType)
  matchType!: CategorizationMatchType

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  pattern!: string

  @IsUUID()
  categoryId!: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
