import { Type } from 'class-transformer'
import { IsIn, IsInt, IsObject, IsBoolean, Min } from 'class-validator'
import type { GenericCsvMapping } from '../parsers/generic-csv-mapper'

/**
 * Validates a `GenericCsvMapping` (`apps/api/src/imports/parsers/
 * generic-csv-mapper.ts`) plus the column count it was confirmed against, at
 * the HTTP boundary -- covers the always-present scalar fields the same way
 * every other request DTO in this codebase validates its inputs
 * (`class-validator`, per `CLAUDE.md`).
 *
 * `sign` is deliberately left to a shallow `@IsObject()` check here rather
 * than decorated field-by-field: it is a discriminated union
 * (`GenericCsvSignConvention`) whose validity depends on *which* variant is
 * present (does `debit_credit` carry a `debitColumn`/`creditColumn` and
 * nothing else? do the referenced columns differ?), which is exactly what
 * `generic-csv-mapper.ts`'s own `validateMapping` already checks -- and is
 * exactly the HTTP-payload case its doc comment anticipated. Re-encoding
 * that logic as class-validator decorators would duplicate it under a
 * different vocabulary instead of reusing it; `CsvSourceMappingService`
 * calls `validateMapping` on every save, so an invalid combination is still
 * rejected before anything is persisted -- just not by this DTO alone.
 */
export class SaveCsvSourceMappingDto implements GenericCsvMapping {
  @IsIn([',', ';'])
  delimiter!: ',' | ';'

  @IsBoolean()
  hasHeader!: boolean

  @IsIn(['utf8', 'latin1'])
  encoding!: 'utf8' | 'latin1'

  @Type(() => Number)
  @IsInt()
  @Min(0)
  dateColumn!: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  descriptionColumn!: number

  @IsIn(['.', ','])
  decimalSeparator!: '.' | ','

  @IsIn(['DMY', 'MDY', 'YMD'])
  dateOrder!: 'DMY' | 'MDY' | 'YMD'

  @IsObject()
  sign!: GenericCsvMapping['sign']

  /** Column count of the file the caller confirmed this mapping against. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  columnCount!: number
}
