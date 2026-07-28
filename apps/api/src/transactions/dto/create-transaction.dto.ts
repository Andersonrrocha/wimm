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
import { TransactionKind } from '@wimm/shared'

export class CreateTransactionDto {
  @IsEnum(TransactionKind)
  kind!: TransactionKind

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  // Bound tracks int4's ceiling in cents (2147483647 / 100). Update this
  // alongside any future change to the `amountCents` column width.
  @Max(21474836.47)
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
