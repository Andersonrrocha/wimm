/**
 * Registry of import format parsers (CSV, OFX, bank-specific PDFs).
 *
 * Each parser declares how it is selected -- a file-name extension, and
 * (for PDF layouts that share the `.pdf` extension) a content sniff over
 * pre-extracted text -- and how a matched file becomes `ParsedLedgerRow`s
 * plus parser warnings. `import-format.ts` walks this registry to detect a
 * file's format; `imports.service.ts` looks a parser up by the detected
 * format and calls `parse` on it. Neither has a hand-rolled per-format
 * branch anymore -- adding a parser means adding it to `IMPORT_PARSERS`,
 * nothing else.
 */

import { BadRequestException } from '@nestjs/common'
import { ImportBatchFormat, type ImportParserWarning } from '@wimm/shared'
import type { ParsedLedgerRow } from './parsers/csv-parser'
import { parseCsvBuffer } from './parsers/csv-parser'
import { parseOfxBuffer } from './parsers/ofx-parser'
import { canParseBanrisulCreditCardPdf } from './parsers/banrisul-cc/banrisul-layout-guard'
import { parseBanrisulStatementFromText } from './parsers/banrisul-cc/parse-statement-text'
import { banrisulStatementToLedgerRows } from './parsers/banrisul-cc/to-ledger-rows'
import { mapBanrisulWarningsForPreview } from './map-banrisul-parser-warnings'
import { canParseCresolStatementPdf } from './parsers/cresol/cresol-layout-guard'
import { parseCresolStatementFromExtractedText } from './parsers/cresol/parse-cresol-statement-extracted-text'
import { cresolStatementToLedgerRows } from './parsers/cresol/to-ledger-rows'
import { mapCresolWarningsForPreview } from './map-cresol-parser-warnings'

/** Result of a parser confirming (or rejecting) that it can handle a candidate file. */
export type ImportParserMatch = { ok: true } | { ok: false; message: string }

/**
 * What a parser needs to decide a match and to parse: the raw upload, plus
 * pre-extracted PDF text when applicable.
 */
export interface ImportParserInput {
  buffer: Buffer
  /**
   * Set only for candidates whose extension matched a parser with
   * `needsExtractedText`. Extracted once per file regardless of how many
   * such parsers are registered -- see `import-format.ts`.
   */
  extractedText?: string
}

export interface ImportParseResult {
  rows: ParsedLedgerRow[]
  /** Always an array (possibly empty) -- every parser reports through this one shape. */
  warnings: ImportParserWarning[]
  /** Only credit-card statement PDFs that print their own due date populate this. */
  statementBillingPreview?: {
    paymentDueDate: string
    statementClosingDate?: string
  }
}

/**
 * The contract every import format parser implements.
 *
 * - `extensions` is the cheap, declarative filter: file-name suffixes (no
 *   dot) this parser is eligible for.
 * - `needsExtractedText` says whether `canHandle`/`parse` require PDF text
 *   extraction to have already run (true for content-sniffed PDF layouts;
 *   omitted for formats resolved by extension alone).
 * - `canHandle` confirms a match beyond the extension. A no-op (`{ ok:
 *   true }`) for extension-only formats; for PDFs it is the layout guard.
 * - `parse` turns a confirmed match into ledger rows, warnings, and any
 *   format-specific preview extras.
 */
export interface ImportFormatParser {
  readonly format: ImportBatchFormat
  readonly extensions: readonly string[]
  readonly needsExtractedText?: boolean
  canHandle(input: ImportParserInput): ImportParserMatch
  parse(input: ImportParserInput): ImportParseResult
}

function requireExtractedText(
  input: ImportParserInput,
  formatLabel: string,
): string {
  if (input.extractedText === undefined) {
    throw new BadRequestException(
      `${formatLabel} parser requires pre-extracted PDF text`,
    )
  }
  return input.extractedText
}

const csvParser: ImportFormatParser = {
  format: ImportBatchFormat.CSV,
  extensions: ['csv'],
  canHandle: () => ({ ok: true }),
  parse: (input) => ({
    rows: parseCsvBuffer(input.buffer),
    warnings: [],
  }),
}

const ofxParser: ImportFormatParser = {
  format: ImportBatchFormat.OFX,
  extensions: ['ofx', 'qfx'],
  canHandle: () => ({ ok: true }),
  parse: (input) => ({
    rows: parseOfxBuffer(input.buffer),
    warnings: [],
  }),
}

const banrisulCreditCardParser: ImportFormatParser = {
  format: ImportBatchFormat.PDF_BANRISUL_CC,
  extensions: ['pdf'],
  needsExtractedText: true,
  canHandle: (input) =>
    canParseBanrisulCreditCardPdf(requireExtractedText(input, 'Banrisul')),
  parse: (input) => {
    const text = requireExtractedText(input, 'Banrisul')
    const layout = canParseBanrisulCreditCardPdf(text)
    if (!layout.ok) {
      throw new BadRequestException(layout.message)
    }
    let banrisul: ReturnType<typeof parseBanrisulStatementFromText>
    try {
      banrisul = parseBanrisulStatementFromText(text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new BadRequestException(
        `Could not parse this Banrisul credit card statement PDF: ${msg}`,
      )
    }

    const result: ImportParseResult = {
      rows: banrisulStatementToLedgerRows(banrisul),
      warnings: mapBanrisulWarningsForPreview(banrisul.warnings),
    }
    if (banrisul.statementBilling) {
      const b = banrisul.statementBilling
      result.statementBillingPreview = {
        paymentDueDate: b.paymentDueDate.toISOString().slice(0, 10),
        ...(b.statementClosingDate !== undefined
          ? {
              statementClosingDate: b.statementClosingDate
                .toISOString()
                .slice(0, 10),
            }
          : {}),
      }
    }
    return result
  },
}

const cresolStatementParser: ImportFormatParser = {
  format: ImportBatchFormat.PDF_CRESOL_STATEMENT,
  extensions: ['pdf'],
  needsExtractedText: true,
  canHandle: (input) =>
    canParseCresolStatementPdf(requireExtractedText(input, 'Cresol')),
  parse: (input) => {
    const text = requireExtractedText(input, 'Cresol')
    const layout = canParseCresolStatementPdf(text)
    if (!layout.ok) {
      throw new BadRequestException(layout.message)
    }
    const cresol = parseCresolStatementFromExtractedText(text)
    return {
      rows: cresolStatementToLedgerRows(cresol),
      warnings: mapCresolWarningsForPreview(cresol.warnings),
    }
  },
}

/**
 * Registered parsers, in selection order. PDF candidates are tried in this
 * order when more than one shares the `.pdf` extension (today: Banrisul
 * before Cresol, matching the original dispatch chain in
 * `import-format.ts`).
 */
export const IMPORT_PARSERS: readonly ImportFormatParser[] = [
  csvParser,
  ofxParser,
  banrisulCreditCardParser,
  cresolStatementParser,
]

/** Parsers whose extension (without leading dot) matches `fileName`, in registration order. */
export function findParsersForFileName(
  fileName: string,
): readonly ImportFormatParser[] {
  const lower = fileName.toLowerCase()
  return IMPORT_PARSERS.filter((p) =>
    p.extensions.some((ext) => lower.endsWith(`.${ext}`)),
  )
}

/** Looks up a registered parser by the format `detectImportFormat` already decided on. */
export function getImportParser(
  format: ImportBatchFormat,
): ImportFormatParser {
  const parser = IMPORT_PARSERS.find((p) => p.format === format)
  if (!parser) {
    throw new BadRequestException('Unsupported import format')
  }
  return parser
}
