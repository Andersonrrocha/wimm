import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { ImportBatchFormat, TransactionKind } from '@prisma/client'

export class ImportStatementBillingDto {
  @IsDateString()
  paymentDueDate!: string

  @IsOptional()
  @IsDateString()
  statementClosingDate?: string
}

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

  @IsOptional()
  @IsUUID()
  categoryId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  installmentCurrent?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  installmentTotal?: number
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

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportStatementBillingDto)
  statementBilling?: ImportStatementBillingDto

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommitImportRowDto)
  rows!: CommitImportRowDto[]
}
