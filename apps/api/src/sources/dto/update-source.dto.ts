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

export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string

  @IsOptional()
  @IsEnum(SourceType)
  type?: SourceType

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
