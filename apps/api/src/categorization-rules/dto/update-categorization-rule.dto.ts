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

export class UpdateCategorizationRuleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number

  @IsOptional()
  @IsEnum(CategorizationMatchType)
  matchType?: CategorizationMatchType

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  pattern?: string

  @IsOptional()
  @IsUUID()
  categoryId?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
