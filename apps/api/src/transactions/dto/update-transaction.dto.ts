import { Type } from 'class-transformer'
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { TransactionKind } from '@prisma/client'

export class UpdateTransactionDto {
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount?: number

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  description?: string

  @IsOptional()
  @IsDateString()
  occurredAt?: string

  @IsOptional()
  @IsUUID()
  sourceId?: string | null

  @IsOptional()
  @IsUUID()
  categoryId?: string | null
}
