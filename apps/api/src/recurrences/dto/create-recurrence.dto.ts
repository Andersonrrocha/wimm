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
  ValidateIf,
} from 'class-validator'
import {
  RecurrenceEndMode,
  RecurrenceFrequency,
  TransactionKind,
} from '@wimm/shared'

export class CreateRecurrenceDto {
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

  @IsOptional()
  @IsUUID()
  sourceId?: string

  @IsOptional()
  @IsUUID()
  categoryId?: string

  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency

  @IsDateString()
  startDate!: string

  @IsEnum(RecurrenceEndMode)
  endMode!: RecurrenceEndMode

  @ValidateIf((o: CreateRecurrenceDto) => o.endMode === 'UNTIL_DATE')
  @IsDateString()
  endDate?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
