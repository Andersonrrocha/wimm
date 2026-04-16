import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { ImportBatchFormat, TransactionKind } from '@prisma/client'

export class CommitImportRowDto {
  @IsDateString()
  occurredAt!: string

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
}

export class CommitImportDto {
  @IsUUID()
  sourceId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  fileName!: string

  @IsEnum(ImportBatchFormat)
  format!: ImportBatchFormat

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommitImportRowDto)
  rows!: CommitImportRowDto[]
}
