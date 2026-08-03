import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  validateMapping,
  type GenericCsvDelimiter,
  type GenericCsvEncoding,
  type GenericCsvMapping,
} from './parsers/generic-csv-mapper'
import type { DateOrder, DecimalSeparator } from './parsers/amount-date'

/**
 * A confirmed `GenericCsvMapping` plus the column count the file had when it
 * was confirmed. See the `CsvSourceMapping` model doc comment in
 * `schema.prisma` for why `columnCount` is stored alongside the mapping and
 * why `sign` is persisted as one opaque blob rather than decomposed columns.
 */
export interface StoredCsvSourceMapping {
  mapping: GenericCsvMapping
  columnCount: number
}

type CsvSourceMappingRow = {
  delimiter: string
  hasHeader: boolean
  encoding: string
  dateColumn: number
  descriptionColumn: number
  decimalSeparator: string
  dateOrder: string
  signConfig: string
  columnCount: number
}

function parseSignConfig(raw: string): GenericCsvMapping['sign'] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new BadRequestException(
      `Stored CSV mapping has a corrupted sign configuration: ${detail}`,
    )
  }
  return parsed as GenericCsvMapping['sign']
}

/**
 * Reconstructs the in-memory `GenericCsvMapping` shape from a persisted row.
 * The row's own CHECK constraints (delimiter/encoding/decimalSeparator/
 * dateOrder, see `check-constraints.ts`) guarantee those four columns can
 * only ever hold one of their declared literals, so the casts below are safe
 * given data that actually came from this table -- `validateMapping` (run by
 * every caller through `applyGenericCsvMapping`) is what catches a `sign`
 * blob that fails to round-trip as a valid discriminated union.
 */
function rowToStoredMapping(row: CsvSourceMappingRow): StoredCsvSourceMapping {
  return {
    mapping: {
      delimiter: row.delimiter as GenericCsvDelimiter,
      hasHeader: row.hasHeader,
      encoding: row.encoding as GenericCsvEncoding,
      dateColumn: row.dateColumn,
      descriptionColumn: row.descriptionColumn,
      decimalSeparator: row.decimalSeparator as DecimalSeparator,
      dateOrder: row.dateOrder as DateOrder,
      sign: parseSignConfig(row.signConfig),
    },
    columnCount: row.columnCount,
  }
}

/**
 * Persists a `GenericCsvMapping` per `Source` (Stage 2, Task 4) so a user
 * maps a bank's CSV export once and every later import from that source
 * reuses it -- see `ImportsService.preview`, the only caller that reads a
 * saved mapping today. One row per source: `upsertForSource` both creates
 * the first mapping and edits it in place afterwards, on the same
 * `sourceId`-keyed row.
 */
@Injectable()
export class CsvSourceMappingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up the saved mapping for a source, scoped to its owner. Returns
   * `null` when the source has no saved mapping (or does not belong to
   * `userId`) -- callers fall back to the default header-name heuristic
   * (`csv-parser.ts`) in that case, exactly as if this service did not
   * exist.
   */
  async findForSource(
    userId: string,
    sourceId: string,
  ): Promise<StoredCsvSourceMapping | null> {
    const row = await this.prisma.csvSourceMapping.findFirst({
      where: { sourceId, source: { userId } },
    })
    return row ? rowToStoredMapping(row) : null
  }

  /**
   * Saves the mapping for a source, or edits the existing one in place --
   * upserted on `sourceId`, which is `@unique` in the schema. `columnCount`
   * is the column count of the file the caller confirmed this mapping
   * against.
   *
   * Validates with the mapper's own `validateMapping` before writing
   * anything: a malformed `sign` combination (impossible to construct in
   * TypeScript, but not impossible in a raw HTTP payload) is rejected here
   * rather than persisted and only discovered on the next import.
   */
  async upsertForSource(
    userId: string,
    sourceId: string,
    mapping: GenericCsvMapping,
    columnCount: number,
  ): Promise<StoredCsvSourceMapping> {
    if (!Number.isInteger(columnCount) || columnCount < 1) {
      throw new BadRequestException('columnCount must be a positive integer')
    }
    validateMapping(mapping)

    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
      select: { id: true },
    })
    if (!source) {
      throw new BadRequestException('Invalid source')
    }

    const data = {
      delimiter: mapping.delimiter,
      hasHeader: mapping.hasHeader,
      encoding: mapping.encoding,
      dateColumn: mapping.dateColumn,
      descriptionColumn: mapping.descriptionColumn,
      decimalSeparator: mapping.decimalSeparator,
      dateOrder: mapping.dateOrder,
      signConfig: JSON.stringify(mapping.sign),
      columnCount,
    }

    const row = await this.prisma.csvSourceMapping.upsert({
      where: { sourceId },
      create: { sourceId, ...data },
      update: data,
    })

    return rowToStoredMapping(row)
  }
}
