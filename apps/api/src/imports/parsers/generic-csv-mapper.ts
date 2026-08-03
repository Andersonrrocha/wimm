import { BadRequestException } from '@nestjs/common'
import {
  parseFlexibleAmount,
  parseFlexibleDate,
  type DateOrder,
  type DecimalSeparator,
} from './amount-date'
import type { CsvParseResult, CsvParseWarning, ParsedLedgerRow } from './csv-parser'

/** papaparse is CJS (`module.exports`); default import is undefined without `esModuleInterop`. */
import Papa = require('papaparse')

/**
 * Generic CSV mapper -- imports a statement from a bank nobody wrote a
 * parser for, by having the caller state exactly what each column means
 * instead of guessing (see `csv-parser.ts` for the header-name/positional
 * heuristic this is *additional* to, not a replacement for).
 *
 * The reason every ambiguous property below is *stated* rather than
 * detected: `1.234` is `1234` for a Brazilian bank and `1.234` for an
 * American one, and `03/04/2026` is 3 April or 4 March depending on the
 * source -- both are legal single-separator readings with opposite, silent
 * answers. `generic-csv-mapping-detector.ts` proposes a mapping; it never
 * decides one. Only a mapping the caller has confirmed reaches this module.
 */

/** `,` is the common international delimiter; `;` is common for Brazilian exports precisely because `,` is the decimal separator there. */
export type GenericCsvDelimiter = ',' | ';'

/**
 * Latin-1 (ISO-8859-1) is still common in Brazilian bank exports. Decoding
 * one of those as UTF-8 mangles every accented description (`,` becomes a
 * safe delimiter choice for the same reason). Only these two are supported
 * -- like decimal separator and date order, encoding is stated by the
 * mapping, never sniffed from the bytes by this module.
 */
export type GenericCsvEncoding = 'utf8' | 'latin1'

/**
 * The three sign conventions observed in real bank exports:
 * - `signed_amount`: one column already carries the sign (e.g. `-123.45`).
 * - `debit_credit`: separate debit/credit columns; exactly one is populated
 *   per row, and which column it is decides the sign.
 * - `amount_and_type`: an unsigned amount column plus a type column whose
 *   value (`D`/`C`, `DEBIT`/`CREDIT`, `DEBITO`/`CREDITO`, ...) decides the
 *   sign. `debitValues`/`creditValues` are compared case- and accent-
 *   insensitively, so the mapping states literal tokens rather than a parser
 *   guessing a locale.
 */
export type GenericCsvSignConvention =
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
 * Everything a generic CSV mapping states about one source's export, so
 * that no ambiguous format is ever resolved by guessing at import time.
 * Column indices are 0-based and refer to the physical column position,
 * regardless of whether a header row is present.
 */
export interface GenericCsvMapping {
  delimiter: GenericCsvDelimiter
  /** Whether row 1 is a header (skipped) rather than the first data row. */
  hasHeader: boolean
  encoding: GenericCsvEncoding
  dateColumn: number
  descriptionColumn: number
  /** Always passed to `parseFlexibleAmount` -- the heuristic default is never used here. */
  decimalSeparator: DecimalSeparator
  /** Always passed to `parseFlexibleDate` -- the heuristic default is never used here. */
  dateOrder: DateOrder
  sign: GenericCsvSignConvention
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function normalizeToken(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

/**
 * Defensive validation of the mapping shape. TypeScript already narrows the
 * literal unions at compile time for a caller within this codebase, but this
 * module will eventually be reached from a persisted mapping (Task 4) and,
 * later, an HTTP payload (Task 5) -- both bypass the compiler, so a mapping
 * that is malformed at runtime fails loudly here rather than degrading into
 * silently-wrong output further down.
 *
 * Exported (not just used internally by `applyGenericCsvMapping`) so
 * `csv-source-mapping.service.ts` (Task 4) can run the exact same check
 * before persisting a mapping, instead of re-implementing sign-shape
 * validation a second time.
 */
export function validateMapping(mapping: GenericCsvMapping): void {
  if (mapping.delimiter !== ',' && mapping.delimiter !== ';') {
    throw new BadRequestException(
      `Invalid CSV mapping: unsupported delimiter ${JSON.stringify(mapping.delimiter)}`,
    )
  }
  if (mapping.encoding !== 'utf8' && mapping.encoding !== 'latin1') {
    throw new BadRequestException(
      `Invalid CSV mapping: unsupported encoding ${JSON.stringify(mapping.encoding)}`,
    )
  }
  if (mapping.decimalSeparator !== '.' && mapping.decimalSeparator !== ',') {
    throw new BadRequestException(
      `Invalid CSV mapping: unsupported decimal separator ${JSON.stringify(mapping.decimalSeparator)}`,
    )
  }
  if (!['DMY', 'MDY', 'YMD'].includes(mapping.dateOrder)) {
    throw new BadRequestException(
      `Invalid CSV mapping: unsupported date order ${JSON.stringify(mapping.dateOrder)}`,
    )
  }
  if (!isNonNegativeInt(mapping.dateColumn)) {
    throw new BadRequestException('Invalid CSV mapping: dateColumn must be a non-negative integer')
  }
  if (!isNonNegativeInt(mapping.descriptionColumn)) {
    throw new BadRequestException(
      'Invalid CSV mapping: descriptionColumn must be a non-negative integer',
    )
  }

  const sign = mapping.sign
  if (sign.kind === 'signed_amount') {
    if (!isNonNegativeInt(sign.amountColumn)) {
      throw new BadRequestException('Invalid CSV mapping: amountColumn must be a non-negative integer')
    }
  } else if (sign.kind === 'debit_credit') {
    if (!isNonNegativeInt(sign.debitColumn) || !isNonNegativeInt(sign.creditColumn)) {
      throw new BadRequestException(
        'Invalid CSV mapping: debitColumn/creditColumn must be non-negative integers',
      )
    }
    if (sign.debitColumn === sign.creditColumn) {
      throw new BadRequestException(
        'Invalid CSV mapping: debitColumn and creditColumn must be different columns',
      )
    }
  } else {
    if (!isNonNegativeInt(sign.amountColumn) || !isNonNegativeInt(sign.typeColumn)) {
      throw new BadRequestException(
        'Invalid CSV mapping: amountColumn/typeColumn must be non-negative integers',
      )
    }
    if (sign.amountColumn === sign.typeColumn) {
      throw new BadRequestException(
        'Invalid CSV mapping: amountColumn and typeColumn must be different columns',
      )
    }
    if (sign.debitValues.length === 0 || sign.creditValues.length === 0) {
      throw new BadRequestException(
        'Invalid CSV mapping: debitValues and creditValues must each list at least one token',
      )
    }
    const debitNormalized = new Set(sign.debitValues.map(normalizeToken))
    const creditNormalized = sign.creditValues.map(normalizeToken)
    if (creditNormalized.some((v) => debitNormalized.has(v))) {
      throw new BadRequestException(
        'Invalid CSV mapping: debitValues and creditValues must not overlap',
      )
    }
  }
}

/**
 * Decodes the raw upload using the mapping's stated encoding. Deliberately
 * only two options -- see `GenericCsvEncoding` -- because encoding is exactly
 * as ambiguous, and exactly as important to get stated rather than guessed,
 * as decimal separator or date order.
 */
function decodeGenericCsvBuffer(buffer: Buffer, encoding: GenericCsvEncoding): string {
  if (encoding === 'utf8') {
    // Same BOM handling as the header-driven CSV parser (csv-parser.ts).
    return buffer.toString('utf8').replace(/^\uFEFF/, '')
  }
  // Node's 'latin1' maps each byte 0x00-0xFF directly to the matching
  // Unicode code point (ISO-8859-1), which is what "decode as Latin-1"
  // means for a Brazilian bank export. There is no BOM convention for
  // Latin-1 text, so none is stripped here.
  return buffer.toString('latin1')
}

/**
 * Counts the widest data row in a CSV buffer, decoded and split using only
 * the mapping's `delimiter`/`encoding`/`hasHeader` -- the fields that decide
 * how many columns a row has, independent of what any of them are said to
 * mean.
 *
 * Used by `csv-source-mapping.service.ts` (Task 4) to compare a file's
 * actual shape against the column count recorded when a mapping was saved.
 * A saved mapping's column *indices* stay syntactically valid as long as
 * they are within range, but a bank export changing its column count is the
 * cheapest honest signal that positions may have shifted meaning -- so this
 * is a sniff for that signal, not a validation of the mapping itself.
 * Deliberately tolerant: a delimiter/encoding mismatch or malformed CSV is
 * not this function's concern, and is instead surfaced by
 * `applyGenericCsvMapping` when it actually parses the file; on a papaparse
 * error here, `0` is returned so the caller's mismatch check still fires
 * (real column count 0 can never equal a saved `columnCount`, which is
 * always >= 1) rather than throwing before the real parse gets a chance to
 * produce its own, more specific diagnostics.
 */
export function countGenericCsvColumns(
  buffer: Buffer,
  mapping: Pick<GenericCsvMapping, 'delimiter' | 'encoding' | 'hasHeader'>,
): number {
  const text = decodeGenericCsvBuffer(buffer, mapping.encoding)
  const parsed = Papa.parse<string[]>(text, {
    delimiter: mapping.delimiter,
    header: false,
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.length > 0) return 0

  let rows = parsed.data
  if (mapping.hasHeader) {
    rows = rows.slice(1)
  }
  return rows.reduce((max, r) => Math.max(max, r.length), 0)
}

/** Renders a row as `col0=value; col1=value; ...` -- every column, not just the ones this mapping reads. */
function formatIndexedRow(cols: string[]): string {
  return cols.map((v, i) => `col${i}=${String(v ?? '').trim()}`).join('; ')
}

type SignedAmountResult =
  | { ok: true; signedAmount: number }
  | { ok: false; code: 'missing_amount' | 'invalid_amount'; detail: string }

/**
 * Resolves one row's signed amount under whichever of the three sign
 * conventions the mapping states. Never falls back to a different
 * convention and never guesses a sign: a value that cannot be resolved
 * under the *stated* convention is reported and the row is dropped, exactly
 * like `missing_amount`/`invalid_amount` for the header-driven parser.
 */
function resolveSignedAmount(
  cols: string[],
  sign: GenericCsvSignConvention,
  decimalSeparator: DecimalSeparator,
): SignedAmountResult {
  const cell = (i: number) => (cols[i] ?? '').trim()

  if (sign.kind === 'signed_amount') {
    const raw = cell(sign.amountColumn)
    if (!raw) {
      return { ok: false, code: 'missing_amount', detail: 'amount value missing' }
    }
    try {
      return { ok: true, signedAmount: parseFlexibleAmount(raw, { decimalSeparator }) }
    } catch (e) {
      return { ok: false, code: 'invalid_amount', detail: messageOf(e) }
    }
  }

  if (sign.kind === 'debit_credit') {
    const debitRaw = cell(sign.debitColumn)
    const creditRaw = cell(sign.creditColumn)
    const debitPresent = debitRaw !== ''
    const creditPresent = creditRaw !== ''

    if (!debitPresent && !creditPresent) {
      return {
        ok: false,
        code: 'missing_amount',
        detail: 'neither the debit nor the credit column has a value',
      }
    }
    if (debitPresent && creditPresent) {
      return {
        ok: false,
        code: 'invalid_amount',
        detail: `both debit ("${debitRaw}") and credit ("${creditRaw}") columns are populated`,
      }
    }
    try {
      // A debit is money leaving the account (an expense, negative); a
      // credit is money arriving (income, positive). The magnitude comes
      // from whichever column is populated -- its own sign notation (if any)
      // is discarded in favour of the column it was found in, since the
      // whole point of separate debit/credit columns is that the column
      // itself carries the sign, not the text within it.
      if (debitPresent) {
        const magnitude = Math.abs(parseFlexibleAmount(debitRaw, { decimalSeparator }))
        return { ok: true, signedAmount: -magnitude }
      }
      const magnitude = Math.abs(parseFlexibleAmount(creditRaw, { decimalSeparator }))
      return { ok: true, signedAmount: magnitude }
    } catch (e) {
      return { ok: false, code: 'invalid_amount', detail: messageOf(e) }
    }
  }

  // amount_and_type
  const amountRaw = cell(sign.amountColumn)
  const typeRaw = cell(sign.typeColumn)
  if (!amountRaw) {
    return { ok: false, code: 'missing_amount', detail: 'amount value missing' }
  }
  let magnitude: number
  try {
    magnitude = Math.abs(parseFlexibleAmount(amountRaw, { decimalSeparator }))
  } catch (e) {
    return { ok: false, code: 'invalid_amount', detail: messageOf(e) }
  }
  const normalizedType = normalizeToken(typeRaw)
  const isDebit = sign.debitValues.some((v) => normalizeToken(v) === normalizedType)
  const isCredit = sign.creditValues.some((v) => normalizeToken(v) === normalizedType)
  if (isDebit === isCredit) {
    // Neither list matched (the common case for a typo or an unexpected
    // token), or the mapping's own lists overlap and both matched -- either
    // way the sign cannot be established from the type column alone.
    return {
      ok: false,
      code: 'invalid_amount',
      detail: `unrecognized type value "${typeRaw}" (expected one of [${sign.debitValues.join(', ')}] for debit or [${sign.creditValues.join(', ')}] for credit)`,
    }
  }
  return { ok: true, signedAmount: isDebit ? -magnitude : magnitude }
}

/**
 * Applies a fully-stated mapping to a raw CSV buffer, producing the same
 * `ParsedLedgerRow`/`CsvParseWarning` shapes the header-driven parser does
 * (`csv-parser.ts`), so every downstream consumer -- warning-to-preview
 * mapping, duplicate detection, commit -- needs no special case for a
 * generically-mapped import.
 *
 * Reuses the exact same warning vocabulary: `missing_date`, `missing_amount`,
 * `invalid_date`, `invalid_amount` (warn and drop the row) and `zero_amount`
 * (warn and import the row) -- see the decision note in `csv-parser.ts` for
 * why a zero amount is imported rather than silently dropped.
 */
export function applyGenericCsvMapping(
  buffer: Buffer,
  mapping: GenericCsvMapping,
): CsvParseResult {
  validateMapping(mapping)

  const text = decodeGenericCsvBuffer(buffer, mapping.encoding)
  const parsed = Papa.parse<string[]>(text, {
    delimiter: mapping.delimiter,
    header: false,
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join('; ')
    throw new BadRequestException(`CSV parse error: ${msg}`)
  }

  let dataRows = parsed.data
  if (mapping.hasHeader) {
    dataRows = dataRows.slice(1)
  }
  if (dataRows.length === 0) {
    throw new BadRequestException('CSV has no data rows')
  }

  const warnings: CsvParseWarning[] = []
  const out: ParsedLedgerRow[] = []

  dataRows.forEach((cols, i) => {
    const rowNumber = i + 1
    const rawLine = formatIndexedRow(cols)
    const dateStr = (cols[mapping.dateColumn] ?? '').trim()
    const desc = (cols[mapping.descriptionColumn] ?? '').trim()

    if (!dateStr) {
      warnings.push({
        code: 'missing_date',
        message: `Row ${rowNumber}: missing date value -- row skipped`,
        rawLine,
      })
      return
    }

    let occurredAt: Date
    try {
      occurredAt = parseFlexibleDate(dateStr, { order: mapping.dateOrder })
    } catch (e) {
      warnings.push({
        code: 'invalid_date',
        message: `Row ${rowNumber}: could not parse date "${dateStr}" (${messageOf(e)}) -- row skipped`,
        rawLine,
      })
      return
    }

    const signResult = resolveSignedAmount(cols, mapping.sign, mapping.decimalSeparator)
    if (!signResult.ok) {
      warnings.push({
        code: signResult.code,
        message:
          signResult.code === 'missing_amount'
            ? `Row ${rowNumber}: missing amount value -- row skipped`
            : `Row ${rowNumber}: could not parse amount (${signResult.detail}) -- row skipped`,
        rawLine,
      })
      return
    }

    const { signedAmount } = signResult
    if (Math.abs(signedAmount) < 0.000_000_1) {
      warnings.push({
        code: 'zero_amount',
        message: `Row ${rowNumber}: amount parsed as zero -- row imported as-is (e.g. a reversal, waived fee, or corrected entry)`,
        rawLine,
      })
    }

    out.push({
      occurredAt,
      signedAmount,
      description: desc || '(no description)',
    })
  })

  if (out.length === 0) {
    throw new BadRequestException(
      'Could not parse any CSV rows with the stated mapping (check column indices, delimiter, and format)',
    )
  }

  return { rows: out, warnings }
}
