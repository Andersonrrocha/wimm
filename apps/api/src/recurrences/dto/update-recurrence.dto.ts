import { Type } from 'class-transformer'
import {
  IsBoolean,
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
import {
  RecurrenceEndMode,
  RecurrenceFrequency,
  TransactionKind,
} from '@wimm/shared'

export class UpdateRecurrenceDto {
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  // Bound tracks int4's ceiling in cents (2147483647 / 100). Update this
  // alongside any future change to the `amountCents` column width.
  @Max(21474836.47)
  amount?: number

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  description?: string

  @IsOptional()
  @IsUUID()
  sourceId?: string | null

  @IsOptional()
  @IsUUID()
  categoryId?: string | null

  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency

  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsEnum(RecurrenceEndMode)
  endMode?: RecurrenceEndMode

  @IsOptional()
  @IsDateString()
  endDate?: string | null

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
