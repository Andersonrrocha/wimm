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

/**
 * Thrown when a persisted `CsvSourceMapping` row exists but no longer decodes
 * into a valid `GenericCsvMapping` -- the JSON in `signConfig` failed to
 * parse, or parsed into something `validateMapping` rejects (wrong `kind`,
 * a variant missing its required columns, overlapping debit/credit tokens,
 * ...).
 *
 * Storing `sign` as one opaque JSON blob (see the model doc comment in
 * `schema.prisma`) was the right call for keeping the sign union's invalid
 * combinations unrepresentable at the schema level, but it also means the
 * database's own constraints cannot catch a corrupted blob -- an older app
 * version's format, a hand-edited row, a partially restored backup (this app
 * restores from backups by design) all reach this exact path. Read-time
 * validation is the *only* thing standing between a corrupted row and a
 * caller that trusts it, so this class exists to name that failure
 * distinctly from "no mapping saved" (`findForSource` still returns `null`
 * for that) and from any other, unrelated error -- callers decide what to do
 * with it (see `ImportsService.preview`, which turns it into a visible
 * warning and falls back to automatic detection rather than failing the
 * import or, worse, silently ignoring that the saved mapping was unusable).
 */
export class InvalidStoredCsvMappingError extends Error {
  constructor(sourceId: string, detail: string) {
    super(
      `Stored CSV mapping for source ${sourceId} is no longer valid (${detail}) -- ` +
        'it must be re-created before it can be used again.',
    )
    this.name = 'InvalidStoredCsvMappingError'
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Reconstructs the in-memory `GenericCsvMapping` shape from a persisted row,
 * and -- unlike a bare cast -- actually validates it before returning it.
 * The row's own CHECK constraints (delimiter/encoding/decimalSeparator/
 * dateOrder, see `check-constraints.ts`) guarantee those four columns can
 * only ever hold one of their declared literals, so casting them back to
 * their literal-union types is safe. `signConfig` has no such guarantee --
 * it is the one column deliberately left outside the CHECK-constrained,
 * database-verified part of this model (see `InvalidStoredCsvMappingError`)
 * -- so it is parsed *and* run through `validateMapping` here, on every
 * read, not only at write time. Throws `InvalidStoredCsvMappingError` (never
 * returns a mapping that hasn't passed `validateMapping`) so a corrupted row
 * fails loudly, named for what it is, instead of silently reaching
 * `applyGenericCsvMapping` later and surfacing as a generic-looking
 * `amountColumn` validation error while the user only asked to import a
 * file.
 */
function rowToStoredMapping(
  row: CsvSourceMappingRow,
  sourceId: string,
): StoredCsvSourceMapping {
  let sign: GenericCsvMapping['sign']
  try {
    sign = JSON.parse(row.signConfig) as GenericCsvMapping['sign']
  } catch (e) {
    throw new InvalidStoredCsvMappingError(
      sourceId,
      `corrupted sign configuration: ${messageOf(e)}`,
    )
  }

  const mapping: GenericCsvMapping = {
    delimiter: row.delimiter as GenericCsvDelimiter,
    hasHeader: row.hasHeader,
    encoding: row.encoding as GenericCsvEncoding,
    dateColumn: row.dateColumn,
    descriptionColumn: row.descriptionColumn,
    decimalSeparator: row.decimalSeparator as DecimalSeparator,
    dateOrder: row.dateOrder as DateOrder,
    sign,
  }

  try {
    validateMapping(mapping)
  } catch (e) {
    throw new InvalidStoredCsvMappingError(sourceId, messageOf(e))
  }

  return { mapping, columnCount: row.columnCount }
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
    return row ? rowToStoredMapping(row, sourceId) : null
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

    return rowToStoredMapping(row, sourceId)
  }
}
