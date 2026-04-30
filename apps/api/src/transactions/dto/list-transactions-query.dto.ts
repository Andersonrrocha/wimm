import { Type } from 'class-transformer'
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator'

export class ListTransactionsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string

  @IsOptional()
  @IsUUID()
  categoryId?: string

  @IsOptional()
  @IsUUID()
  sourceId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  /**
   * When `'false'`, excludes projected installment legs (`isProjected: true`)
   * created during credit card import. Recurrence-generated rows are unaffected.
   * Kept as string to avoid `enableImplicitConversion` coercing `'false'` → `true`.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeProjected?: string

  /** When `'true'`, only transactions with `categoryId` null. Ignores `categoryId`. */
  @IsOptional()
  @IsIn(['true', 'false'])
  uncategorizedOnly?: string
}
