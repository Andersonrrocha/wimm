import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { SourceType } from '@prisma/client'

export class CreateSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string

  @IsEnum(SourceType)
  type!: SourceType

  /** Required when type is CREDIT_CARD; must be omitted or null for other types (enforced in service). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number
}
