/**
 * Wire contract for the CSV column-mapping IPC surface (`csv-mapping:*`,
 * Stage 2 Task 5), shared between the renderer (the mapping screen), the
 * preload bridge (which only relays these shapes across `contextBridge`,
 * never inspects them), and main (which actually runs the backend's
 * detection/mapper functions).
 *
 * **Why these types are redeclared here instead of imported from
 * `@wimm/api`.** `GenericCsvMapping`/`GenericCsvMappingProposal` already
 * exist in `apps/api/src/imports/parsers/generic-csv-mapper.ts` and
 * `generic-csv-mapping-detector.ts` -- this module is a deliberate,
 * type-only mirror of their wire shape, not a second implementation of any
 * logic. Two things rule out importing them directly: (1) this stage's task
 * scope is `apps/desktop` only, and (2) even if it weren't, only
 * `src/main` may import from `@wimm/api` at all (see `local-api.ts`'s module
 * doc comment on why `@wimm/api` is kept external to the main-process bundle
 * and never touched by the renderer/preload bundles) -- a type shared with
 * the renderer cannot come from a package the renderer's bundle never sees.
 * Every field name and union member below is kept byte-for-byte identical to
 * its `@wimm/api` counterpart specifically so a value that crosses this
 * boundary round-trips through `validateMapping`
 * (`apps/api/src/imports/parsers/generic-csv-mapper.ts`) unchanged, whether
 * it is going into `csv-mapping:apply` (a pure, unauthenticated function
 * call handled entirely in main, see `csv-mapping-bridge.ts`) or into the
 * existing, already-shipped `PUT /imports/csv-mapping/:sourceId` endpoint
 * (reached the normal way, through `apiClient` and the existing
 * `local-api:request` bridge -- this mapping screen adds no new HTTP
 * surface, only new pure-function IPC surface for detection and preview).
 */

/** `,` is the common international delimiter; `;` is common for Brazilian exports precisely because `,` is the decimal separator there. */
export type CsvMappingDelimiter = ',' | ';'

/** Latin-1 (ISO-8859-1) is still common in Brazilian bank exports; UTF-8 is the common case otherwise. */
export type CsvMappingEncoding = 'utf8' | 'latin1'

export type CsvMappingDecimalSeparator = '.' | ','

export type CsvMappingDateOrder = 'DMY' | 'MDY' | 'YMD'

/**
 * The three sign conventions a bank's CSV export can use -- mirrors
 * `GenericCsvSignConvention` exactly. See that type's doc comment
 * (`generic-csv-mapper.ts`) for what each variant means.
 */
export type CsvMappingSignConvention =
  | { kind: 'signed_amount'; amountColumn: number }
  | { kind: 'debit_credit'; debitColumn: number; creditColumn: number }
  | {
      kind: 'amount_and_type'
      amountColumn: number
      typeColumn: number
      debitValues: string[]
      creditValues: string[]
    }

/**
 * Everything a generic CSV mapping states about one source's export --
 * mirrors `GenericCsvMapping` exactly. Column indices are 0-based and refer
 * to the physical column position, regardless of whether a header row is
 * present.
 */
export interface CsvMapping {
  delimiter: CsvMappingDelimiter
  hasHeader: boolean
  encoding: CsvMappingEncoding
  dateColumn: number
  descriptionColumn: number
  decimalSeparator: CsvMappingDecimalSeparator
  dateOrder: CsvMappingDateOrder
  sign: CsvMappingSignConvention
}

export type CsvMappingConfidence = 'high' | 'medium' | 'low'

/**
 * One proposed value, plus how sure the detector is and why -- mirrors
 * `FieldGuess<T>` exactly. The mapping screen renders `confidence` as a
 * badge and `reason` as help text, so a guess is never presented as a
 * certainty (see `generic-csv-mapping-detector.ts`'s module doc comment for
 * why detection can never honestly return `'high'` for e.g. a lone decimal
 * separator).
 */
export interface CsvMappingFieldGuess<T> {
  value: T
  confidence: CsvMappingConfidence
  reason: string
}

/** Mirrors `GenericCsvMappingProposal` exactly -- see that type's doc comment. */
export interface CsvMappingProposal {
  delimiter: CsvMappingFieldGuess<CsvMappingDelimiter>
  hasHeader: CsvMappingFieldGuess<boolean>
  encoding: CsvMappingFieldGuess<CsvMappingEncoding>
  dateColumn: CsvMappingFieldGuess<number | null>
  descriptionColumn: CsvMappingFieldGuess<number | null>
  decimalSeparator: CsvMappingFieldGuess<CsvMappingDecimalSeparator>
  dateOrder: CsvMappingFieldGuess<CsvMappingDateOrder>
  sign: CsvMappingFieldGuess<CsvMappingSignConvention | null>
  overallConfidence: CsvMappingConfidence
  sampledRows: number
  columnCount: number
}

/** One row as the mapping would actually import it -- mirrors `ParsedLedgerRow`, with `occurredAt` serialized to ISO for the IPC/JSON boundary. */
export interface CsvMappingParsedRow {
  occurredAt: string
  signedAmount: number
  description: string
}

/** Mirrors `CsvParseWarning` -- the same vocabulary the header-driven CSV parser and every other import parser use (`missing_date`, `missing_amount`, `invalid_date`, `invalid_amount`, `zero_amount`, ...). */
export interface CsvMappingWarning {
  code: string
  message: string
  rawLine?: string
}

/**
 * Result of applying a (possibly not-yet-saved) mapping to the file, for the
 * live preview. `columnCount` is the file's actual widest row under this
 * mapping's `delimiter`/`encoding`/`hasHeader` -- computed the same way
 * `countGenericCsvColumns` does on the backend, and is exactly the value the
 * mapping screen sends as `columnCount` when the user saves this mapping
 * (`PUT /imports/csv-mapping/:sourceId`), so "what you previewed" and "what
 * gets persisted alongside the mapping" can never drift apart.
 */
export interface CsvMappingApplyResult {
  rows: CsvMappingParsedRow[]
  warnings: CsvMappingWarning[]
  columnCount: number
}
