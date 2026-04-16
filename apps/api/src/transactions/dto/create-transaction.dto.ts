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

export class CreateTransactionDto {
  @IsEnum(TransactionKind)
  kind!: TransactionKind

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  description!: string

  @IsDateString()
  occurredAt!: string

  @IsOptional()
  @IsUUID()
  sourceId?: string

  @IsOptional()
  @IsUUID()
  categoryId?: string
}
