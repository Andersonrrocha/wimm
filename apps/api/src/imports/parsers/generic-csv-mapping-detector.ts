import type { DateOrder, DecimalSeparator } from './amount-date'
import type {
  GenericCsvDelimiter,
  GenericCsvEncoding,
  GenericCsvSignConvention,
} from './generic-csv-mapper'

/** papaparse is CJS (`module.exports`); default import is undefined without `esModuleInterop`. */
import Papa = require('papaparse')

/**
 * Detection *proposes* a mapping; it never decides one. Every ambiguous
 * property a `GenericCsvMapping` states (decimal separator, date order,
 * sign convention, encoding...) is genuinely unresolvable by inspection in
 * the general case -- `1.234` is legitimately either 1234 or one-point-two-
 * three-four, and no amount of pattern-matching changes that. What this
 * module can do honestly is notice *shapes* (a date-shaped column, a
 * currency-shaped column, whether row one looks like a header) and say how
 * sure it is. The caller (Task 5's mapping UI) is expected to show the
 * proposal against a real preview of the file and let the user confirm or
 * correct it -- never apply it silently.
 */

export type MappingConfidence = 'high' | 'medium' | 'low'

/** One proposed value, plus how sure the detector is and why. */
export interface FieldGuess<T> {
  value: T
  confidence: MappingConfidence
  /** Short human-readable justification -- for a UI that wants to explain (or caveat) the guess. */
  reason: string
}

export interface GenericCsvMappingProposal {
  delimiter: FieldGuess<GenericCsvDelimiter>
  hasHeader: FieldGuess<boolean>
  encoding: FieldGuess<GenericCsvEncoding>
  /** `null` when no column in the sample looks date-shaped. */
  dateColumn: FieldGuess<number | null>
  /** `null` when no clearly-textual column stands out from the amount/date columns. */
  descriptionColumn: FieldGuess<number | null>
  decimalSeparator: FieldGuess<DecimalSeparator>
  dateOrder: FieldGuess<DateOrder>
  /** `null` when no amount-shaped column was found at all. */
  sign: FieldGuess<GenericCsvSignConvention | null>
  /** The weakest of every individual guess above -- a proposal is only as trustworthy as its least confident field. */
  overallConfidence: MappingConfidence
  /** How many data rows the guesses above are based on (post header-guess, if any). */
  sampledRows: number
  /** Widest row width observed in the sample. */
  columnCount: number
}

const CONFIDENCE_RANK: Record<MappingConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function weakest(confidences: MappingConfidence[]): MappingConfidence {
  return confidences.reduce<MappingConfidence>(
    (acc, c) => (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[acc] ? c : acc),
    'high',
  )
}

function normalizeToken(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

const NUMERIC_SHAPE =
  /^[+-]?\s*(R\$|\$)?\s*\(?-?\d[\d.,]*\)?-?$/
function looksNumeric(cell: string): boolean {
  const t = cell.trim()
  if (!t) return false
  return NUMERIC_SHAPE.test(t)
}

const DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}|^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$|^\d{8}$/
function looksDateShaped(cell: string): boolean {
  return DATE_SHAPE.test(cell.trim())
}

const DEFAULT_DEBIT_TOKENS = ['D', 'DEBIT', 'DEBITO']
const DEFAULT_CREDIT_TOKENS = ['C', 'CREDIT', 'CREDITO']

function looksLikeTypeColumn(values: string[]): boolean {
  if (values.length === 0) return false
  return values.every((v) => {
    const n = normalizeToken(v)
    return DEFAULT_DEBIT_TOKENS.includes(n) || DEFAULT_CREDIT_TOKENS.includes(n)
  })
}

/**
 * Valid UTF-8 is the common case; a buffer that fails strict UTF-8 decoding
 * is presumed Latin-1 (the common Brazilian-bank fallback) -- but this is
 * still a guess, never a certainty, hence 'medium' rather than 'high'.
 */
function guessEncoding(buffer: Buffer): FieldGuess<GenericCsvEncoding> {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return {
      value: 'utf8',
      confidence: 'high',
      reason: 'the file decodes as valid UTF-8',
    }
  } catch {
    return {
      value: 'latin1',
      confidence: 'medium',
      reason:
        'the file is not valid UTF-8; Latin-1 is the common fallback for Brazilian bank exports, but confirm before relying on this',
    }
  }
}

function decodeForDetection(buffer: Buffer, encoding: GenericCsvEncoding): string {
  if (encoding === 'utf8') {
    return buffer.toString('utf8').replace(/^\uFEFF/, '')
  }
  return buffer.toString('latin1')
}

function isConsistentNonZero(counts: number[]): boolean {
  if (counts.length === 0) return false
  const first = counts[0]
  if (first === 0) return false
  return counts.every((c) => c === first)
}

function guessDelimiter(sampleLines: string[]): FieldGuess<GenericCsvDelimiter> {
  const commaCounts = sampleLines.map((l) => (l.match(/,/g) ?? []).length)
  const semiCounts = sampleLines.map((l) => (l.match(/;/g) ?? []).length)
  const commaConsistent = isConsistentNonZero(commaCounts)
  const semiConsistent = isConsistentNonZero(semiCounts)

  if (semiConsistent && !commaConsistent) {
    return {
      value: ';',
      confidence: 'high',
      reason: 'every sampled line has the same number of ";" and no consistent ","',
    }
  }
  if (commaConsistent && !semiConsistent) {
    return {
      value: ',',
      confidence: 'high',
      reason: 'every sampled line has the same number of "," and no consistent ";"',
    }
  }
  if (semiConsistent && commaConsistent) {
    return {
      value: ';',
      confidence: 'medium',
      reason:
        'both "," and ";" appear a consistent number of times per line -- assuming ";" is the delimiter and "," is a decimal separator inside fields, as is common for Brazilian exports, but confirm before relying on this',
    }
  }
  return {
    value: ',',
    confidence: 'low',
    reason: 'no consistent delimiter pattern found in the sample; defaulting to ","',
  }
}

function guessHasHeader(rows: string[][]): FieldGuess<boolean> {
  if (rows.length < 2) {
    return {
      value: false,
      confidence: 'low',
      reason: 'fewer than two sample rows; nothing to compare a header candidate against',
    }
  }
  const header = rows[0]
  const dataRows = rows.slice(1)
  const headerLooksTextual = header.every(
    (c) => !looksNumeric(c) && !looksDateShaped(c),
  )
  const dataHasNumericOrDate = dataRows.some((r) =>
    r.some((c) => looksNumeric(c) || looksDateShaped(c)),
  )
  if (headerLooksTextual && dataHasNumericOrDate) {
    return {
      value: true,
      confidence: 'high',
      reason:
        'the first row is entirely non-numeric, non-date text while later rows contain numbers or dates',
    }
  }
  const firstRowNumericOrDate = header.some(
    (c) => looksNumeric(c) || looksDateShaped(c),
  )
  if (firstRowNumericOrDate) {
    return {
      value: false,
      confidence: 'medium',
      reason: 'the first row already contains a number or a date -- unlikely to be a header',
    }
  }
  return {
    value: true,
    confidence: 'low',
    reason: 'the first row looks textual, but the rest of the sample is inconclusive',
  }
}

interface NumericRatio {
  col: number
  ratio: number
  nonEmpty: number
}

function numericRatios(dataRows: string[][], columnCount: number): NumericRatio[] {
  const out: NumericRatio[] = []
  for (let c = 0; c < columnCount; c++) {
    const values = dataRows.map((r) => (r[c] ?? '').trim())
    const nonEmptyValues = values.filter((v) => v !== '')
    if (nonEmptyValues.length === 0) {
      out.push({ col: c, ratio: 0, nonEmpty: 0 })
      continue
    }
    const matches = nonEmptyValues.filter((v) => looksNumeric(v)).length
    out.push({ col: c, ratio: matches / nonEmptyValues.length, nonEmpty: nonEmptyValues.length })
  }
  return out
}

function guessDateColumn(
  dataRows: string[][],
  columnCount: number,
): FieldGuess<number | null> {
  let best = { col: -1, ratio: 0 }
  for (let c = 0; c < columnCount; c++) {
    const values = dataRows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '')
    if (values.length === 0) continue
    const matches = values.filter((v) => looksDateShaped(v)).length
    const ratio = matches / values.length
    if (ratio > best.ratio) best = { col: c, ratio }
  }
  if (best.col === -1 || best.ratio === 0) {
    return { value: null, confidence: 'low', reason: 'no column in the sample looks date-shaped' }
  }
  const confidence: MappingConfidence =
    best.ratio >= 0.8 ? 'high' : best.ratio >= 0.5 ? 'medium' : 'low'
  return {
    value: best.col,
    confidence,
    reason: `column ${best.col} looks date-shaped in ${Math.round(best.ratio * 100)}% of the sampled rows`,
  }
}

function guessDescriptionColumn(
  dataRows: string[][],
  dateColumn: number | null,
  numeric: NumericRatio[],
): FieldGuess<number | null> {
  const candidates = numeric.filter((n) => n.col !== dateColumn && n.ratio < 0.3)
  if (candidates.length === 0) {
    return {
      value: null,
      confidence: 'low',
      reason: 'no column stands out as free text once the date column is excluded',
    }
  }
  let best = candidates[0]
  let bestAvgLen = -1
  for (const cand of candidates) {
    const lens = dataRows.map((r) => (r[cand.col] ?? '').trim().length)
    const avg = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1)
    if (avg > bestAvgLen) {
      bestAvgLen = avg
      best = cand
    }
  }
  return {
    value: best.col,
    confidence: candidates.length === 1 ? 'high' : 'medium',
    reason: `column ${best.col} has the lowest numeric-shape ratio and the longest average text among ${candidates.length} candidate column(s)`,
  }
}

function guessSignConvention(
  dataRows: string[][],
  columnCount: number,
  dateColumn: number | null,
  descriptionColumn: number | null,
  numeric: NumericRatio[],
): FieldGuess<GenericCsvSignConvention | null> {
  let typeCol: number | null = null
  for (let c = 0; c < columnCount; c++) {
    if (c === dateColumn || c === descriptionColumn) continue
    const values = dataRows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '')
    if (values.length > 0 && looksLikeTypeColumn(values)) {
      typeCol = c
      break
    }
  }

  const amountCandidates = numeric.filter(
    (n) =>
      n.col !== dateColumn &&
      n.col !== descriptionColumn &&
      n.col !== typeCol &&
      n.ratio >= 0.5,
  )

  if (typeCol !== null && amountCandidates.length === 1) {
    const amountCol = amountCandidates[0].col
    return {
      value: {
        kind: 'amount_and_type',
        amountColumn: amountCol,
        typeColumn: typeCol,
        debitValues: [...DEFAULT_DEBIT_TOKENS],
        creditValues: [...DEFAULT_CREDIT_TOKENS],
      },
      confidence: 'medium',
      reason: `column ${typeCol} contains only debit/credit-style tokens alongside a single amount-shaped column ${amountCol}; confirm the exact tokens before relying on this`,
    }
  }

  if (amountCandidates.length === 2) {
    const [a, b] = amountCandidates
    const bothFilled = dataRows.filter(
      (r) => (r[a.col] ?? '').trim() !== '' && (r[b.col] ?? '').trim() !== '',
    ).length
    if (bothFilled === 0) {
      return {
        value: { kind: 'debit_credit', debitColumn: a.col, creditColumn: b.col },
        confidence: 'medium',
        reason: `columns ${a.col} and ${b.col} are both amount-shaped and never populated on the same row -- looks like separate debit/credit columns, but which is which is a guess`,
      }
    }
  }

  if (amountCandidates.length >= 1) {
    const withNegative = amountCandidates.find((n) =>
      dataRows.some((r) => /^-|-$|^\(.*\)$/.test((r[n.col] ?? '').trim())),
    )
    const chosen = withNegative ?? amountCandidates[0]
    return {
      value: { kind: 'signed_amount', amountColumn: chosen.col },
      confidence: withNegative ? 'medium' : 'low',
      reason: withNegative
        ? `column ${chosen.col} is amount-shaped and contains negative-looking values, suggesting a single signed-amount column`
        : `column ${chosen.col} is the only clear amount-shaped column found, but no negative values were observed to confirm a sign is actually present`,
    }
  }

  return { value: null, confidence: 'low', reason: 'no amount-shaped column found in the sample' }
}

function collectAmountSampleValues(
  dataRows: string[][],
  sign: GenericCsvSignConvention | null,
): string[] {
  if (!sign) return []
  const cols =
    sign.kind === 'signed_amount'
      ? [sign.amountColumn]
      : sign.kind === 'debit_credit'
        ? [sign.debitColumn, sign.creditColumn]
        : [sign.amountColumn]
  const values: string[] = []
  for (const c of cols) {
    for (const r of dataRows) {
      const v = (r[c] ?? '').trim()
      if (v !== '') values.push(v)
    }
  }
  return values
}

/**
 * The crux of the whole detection module: a lone separator (`1.234` /
 * `1,234`) is genuinely ambiguous -- the Stage 2 plan's entire justification
 * for capturing this in the mapping rather than guessing it. This function
 * must never return 'high' confidence for that case.
 */
function guessDecimalSeparator(sampleValues: string[]): FieldGuess<DecimalSeparator> {
  const withBoth = sampleValues.filter((v) => v.includes(',') && v.includes('.'))
  if (withBoth.length > 0) {
    const decisions = withBoth.map((v) =>
      v.lastIndexOf(',') > v.lastIndexOf('.') ? ',' : '.',
    )
    if (decisions.every((d) => d === decisions[0])) {
      return {
        value: decisions[0] as DecimalSeparator,
        confidence: 'high',
        reason: `sampled amounts combine "." and "," consistently (e.g. "${withBoth[0]}"), which fixes the decimal separator unambiguously`,
      }
    }
  }

  const withComma = sampleValues.filter((v) => v.includes(',') && !v.includes('.'))
  const withDot = sampleValues.filter((v) => v.includes('.') && !v.includes(','))
  if (withComma.length > 0 && withDot.length === 0) {
    return {
      value: ',',
      confidence: 'low',
      reason:
        'sampled amounts only ever contain "," -- plausibly the decimal separator, but a lone separator is genuinely ambiguous with a thousands grouping; confirm before relying on this',
    }
  }
  if (withDot.length > 0 && withComma.length === 0) {
    return {
      value: '.',
      confidence: 'low',
      reason:
        'sampled amounts only ever contain "." -- plausibly the decimal separator, but a lone separator is genuinely ambiguous with a thousands grouping; confirm before relying on this',
    }
  }
  return {
    value: '.',
    confidence: 'low',
    reason: 'not enough evidence in the sample to tell "." from "," apart; defaulting to "." but this is a guess',
  }
}

function guessDateOrder(dateValues: string[]): FieldGuess<DateOrder> {
  const trimmed = dateValues.map((v) => v.trim()).filter((v) => v !== '')
  if (trimmed.length === 0) {
    return {
      value: 'DMY',
      confidence: 'low',
      reason: 'no sampled date values to inspect; defaulting to day-first but this is a guess',
    }
  }

  const isoLike = trimmed.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v))
  if (isoLike.length === trimmed.length) {
    return {
      value: 'YMD',
      confidence: 'high',
      reason: 'every sampled date is ISO-shaped (YYYY-MM-DD), which is unambiguous regardless of the stated order',
    }
  }

  const seps = trimmed
    .map((v) => /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(v))
    .filter((m): m is RegExpExecArray => m !== null)
  if (seps.length === 0) {
    return {
      value: 'DMY',
      confidence: 'low',
      reason: 'no separator-delimited dates found in the sample; defaulting to day-first but this is a guess',
    }
  }
  const firstOver12 = seps.some((m) => Number(m[1]) > 12)
  const secondOver12 = seps.some((m) => Number(m[2]) > 12)
  if (firstOver12 && !secondOver12) {
    return {
      value: 'DMY',
      confidence: 'high',
      reason: 'the first field exceeds 12 in at least one sampled date, so that field cannot be a month',
    }
  }
  if (secondOver12 && !firstOver12) {
    return {
      value: 'MDY',
      confidence: 'high',
      reason: 'the second field exceeds 12 in at least one sampled date, so that field cannot be a month',
    }
  }
  return {
    value: 'DMY',
    confidence: 'low',
    reason: 'every sampled date has both fields <= 12; day-first vs. month-first cannot be told apart from content alone',
  }
}

/**
 * Proposes a `GenericCsvMapping` for a raw CSV buffer of unknown origin.
 * Every field comes back as a `FieldGuess` -- a value plus a confidence and
 * a reason -- so a caller (the Task 5 mapping UI) can render "I am not
 * sure" honestly instead of a mapping that merely looks complete. Nothing
 * returned here is ever applied without confirmation; see `generic-csv-mapper.ts`.
 */
export function proposeGenericCsvMapping(
  buffer: Buffer,
  sampleSize = 25,
): GenericCsvMappingProposal {
  const encodingGuess = guessEncoding(buffer)
  const text = decodeForDetection(buffer, encodingGuess.value)
  const allLines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  const sampleLines = allLines.slice(0, sampleSize)

  const delimiterGuess = guessDelimiter(sampleLines)

  const parsed = Papa.parse<string[]>(sampleLines.join('\n'), {
    delimiter: delimiterGuess.value,
    header: false,
    skipEmptyLines: 'greedy',
  })
  const rows = parsed.data
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0)

  const hasHeaderGuess = guessHasHeader(rows)
  const dataRows = hasHeaderGuess.value ? rows.slice(1) : rows

  const numeric = numericRatios(dataRows, columnCount)
  const dateColumnGuess = guessDateColumn(dataRows, columnCount)
  const descriptionColumnGuess = guessDescriptionColumn(
    dataRows,
    dateColumnGuess.value,
    numeric,
  )
  const signGuess = guessSignConvention(
    dataRows,
    columnCount,
    dateColumnGuess.value,
    descriptionColumnGuess.value,
    numeric,
  )

  const amountSampleValues = collectAmountSampleValues(dataRows, signGuess.value)
  const decimalSeparatorGuess = guessDecimalSeparator(amountSampleValues)

  const dateSampleValues =
    dateColumnGuess.value !== null
      ? dataRows
          .map((r) => (r[dateColumnGuess.value as number] ?? '').trim())
          .filter((v) => v !== '')
      : []
  const dateOrderGuess = guessDateOrder(dateSampleValues)

  const overallConfidence = weakest([
    delimiterGuess.confidence,
    hasHeaderGuess.confidence,
    encodingGuess.confidence,
    dateColumnGuess.confidence,
    descriptionColumnGuess.confidence,
    decimalSeparatorGuess.confidence,
    dateOrderGuess.confidence,
    signGuess.confidence,
  ])

  return {
    delimiter: delimiterGuess,
    hasHeader: hasHeaderGuess,
    encoding: encodingGuess,
    dateColumn: dateColumnGuess,
    descriptionColumn: descriptionColumnGuess,
    decimalSeparator: decimalSeparatorGuess,
    dateOrder: dateOrderGuess,
    sign: signGuess,
    overallConfidence,
    sampledRows: dataRows.length,
    columnCount,
  }
}
