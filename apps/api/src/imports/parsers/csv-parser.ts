import { BadRequestException } from '@nestjs/common'
import { parseFlexibleAmount, parseFlexibleDate } from './amount-date'

/** papaparse is CJS (`module.exports`); default import is undefined without `esModuleInterop`. */
import Papa = require('papaparse')

export type ParsedLedgerRow = {
  occurredAt: Date
  signedAmount: number
  description: string
  /** Present for some credit card PDF parsers (e.g. Banrisul). */
  installmentCurrent?: number
  installmentTotal?: number
}

/**
 * Diagnostics for a CSV row that could not become a `ParsedLedgerRow`, or
 * that was accepted but is worth flagging. Mirrors the `code`/`message`/raw
 * snippet shape the Banrisul and Cresol PDF parsers already use -- see
 * `map-csv-parser-warnings.ts`, which turns these into `ImportParserWarning`.
 */
export type CsvParseWarning = {
  code: string
  message: string
  /**
   * The offending row rendered as `column=value` pairs (every column, not
   * just the ones this parser reads), to help a user locate it in the
   * source file.
   */
  rawLine?: string
}

export type CsvParseResult = {
  rows: ParsedLedgerRow[]
  warnings: CsvParseWarning[]
}

const DATE_KEYS = new Set([
  'date',
  'data',
  'dtposted',
  'dt',
  'datetrans',
])
const AMOUNT_KEYS = new Set(['amount', 'valor', 'value', 'trnamt'])
const DESC_KEYS = new Set([
  'description',
  'memo',
  'desc',
  'descricao',
  'historico',
  'name',
  'payee',
])

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function findColumnKey(
  headers: string[],
  candidates: Set<string>,
): string | undefined {
  for (const h of headers) {
    if (candidates.has(normalizeHeader(h))) return h
  }
  return undefined
}

/** Renders a row as `column=value; ...` across every column, not just the ones being read. */
function formatRawRow(fields: string[], row: Record<string, string>): string {
  return fields
    .map((f) => `${f}=${String(row[f] ?? '').trim()}`)
    .join('; ')
}

/**
 * Turns one row's raw date/amount/description strings into a
 * `ParsedLedgerRow`, or appends a `CsvParseWarning` and returns `undefined`.
 *
 * Zero-amount decision: a genuine R$ 0,00 transaction exists (a reversal, a
 * waived fee, a corrected entry). Dropping it would be exactly the silent
 * data loss this parser is being fixed to avoid, so it is imported rather
 * than skipped -- the `zero_amount` warning alone is what makes the
 * exceptional value visible, instead of hiding a legitimate ledger entry.
 */
function parseRow(
  dateStr: string,
  amountStr: string,
  desc: string,
  rowNumber: number,
  rawLine: string,
  warnings: CsvParseWarning[],
): ParsedLedgerRow | undefined {
  if (!dateStr) {
    warnings.push({
      code: 'missing_date',
      message: `Row ${rowNumber}: missing date value -- row skipped`,
      rawLine,
    })
    return undefined
  }
  if (!amountStr) {
    warnings.push({
      code: 'missing_amount',
      message: `Row ${rowNumber}: missing amount value -- row skipped`,
      rawLine,
    })
    return undefined
  }

  let occurredAt: Date
  try {
    occurredAt = parseFlexibleDate(dateStr)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push({
      code: 'invalid_date',
      message: `Row ${rowNumber}: could not parse date "${dateStr}" (${msg}) -- row skipped`,
      rawLine,
    })
    return undefined
  }

  let signedAmount: number
  try {
    signedAmount = parseFlexibleAmount(amountStr)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push({
      code: 'invalid_amount',
      message: `Row ${rowNumber}: could not parse amount "${amountStr}" (${msg}) -- row skipped`,
      rawLine,
    })
    return undefined
  }

  if (Math.abs(signedAmount) < 0.000_000_1) {
    warnings.push({
      code: 'zero_amount',
      message: `Row ${rowNumber}: amount parsed as zero -- row imported as-is (e.g. a reversal, waived fee, or corrected entry)`,
      rawLine,
    })
  }

  return {
    occurredAt,
    signedAmount,
    description: desc || '(no description)',
  }
}

export function parseCsvBuffer(buffer: Buffer): CsvParseResult {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  if (parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join('; ')
    throw new BadRequestException(`CSV parse error: ${msg}`)
  }

  const data = parsed.data.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').trim() !== ''),
  )
  if (data.length === 0) {
    throw new BadRequestException('CSV has no data rows')
  }

  const headers = Object.keys(data[0])
  const dk = findColumnKey(headers, DATE_KEYS)
  const ak = findColumnKey(headers, AMOUNT_KEYS)
  const descK = findColumnKey(headers, DESC_KEYS)

  const out: ParsedLedgerRow[] = []
  const warnings: CsvParseWarning[] = []

  if (dk && ak && descK) {
    data.forEach((row, i) => {
      const dateStr = String(row[dk] ?? '').trim()
      const amountStr = String(row[ak] ?? '').trim()
      const desc = String(row[descK] ?? '').trim()
      const parsedRow = parseRow(
        dateStr,
        amountStr,
        desc,
        i + 1,
        formatRawRow(headers, row),
        warnings,
      )
      if (parsedRow) out.push(parsedRow)
    })
  } else {
    // No recognized date/amount/description headers -- fall back to
    // position: first column is the date, second is the amount, the rest
    // (if any) is the description. `fields.length` is fixed for the whole
    // file (it comes from the header row), so a file with fewer than two
    // columns fails identically for every row; that degenerate case is left
    // to the `out.length === 0` check below, which throws a clear,
    // immediately visible error rather than a per-row warning nobody would
    // ever see (the whole parse fails before a preview exists to show it in).
    const fields = parsed.meta.fields ?? headers
    data.forEach((row, i) => {
      const vals = fields.map((f) => String(row[f] ?? '').trim())
      if (vals.length < 2) return
      const dateStr = vals[0]
      const amountStr = vals[1]
      const desc = vals.length > 2 ? vals.slice(2).join(' ') : ''
      const parsedRow = parseRow(
        dateStr,
        amountStr,
        desc,
        i + 1,
        formatRawRow(fields, row),
        warnings,
      )
      if (parsedRow) out.push(parsedRow)
    })
  }

  if (out.length === 0) {
    throw new BadRequestException(
      'Could not parse any CSV rows (check date/amount columns)',
    )
  }

  return { rows: out, warnings }
}
