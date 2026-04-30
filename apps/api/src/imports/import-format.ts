/**
 * Import file format detection (CSV, OFX, bank-specific PDFs).
 */

import { BadRequestException } from '@nestjs/common'
import { ImportBatchFormat } from '@prisma/client'
import { extractTextFromPdfBuffer } from './parsers/banrisul-cc/extract-pdf-text'
import { canParseBanrisulCreditCardPdf } from './parsers/banrisul-cc/banrisul-layout-guard'
import { canParseCresolStatementPdf } from './parsers/cresol/cresol-layout-guard'

export type DetectedImportFormat =
  | {
      format:
        | typeof ImportBatchFormat.CSV
        | typeof ImportBatchFormat.OFX
    }
  | {
      format: typeof ImportBatchFormat.PDF_BANRISUL_CC
      /** Pre-extracted text (avoid parsing the PDF twice). */
      extractedText: string
    }
  | {
      format: typeof ImportBatchFormat.PDF_CRESOL_STATEMENT
      extractedText: string
    }

export function isBanrisulPdfFormat(
  d: DetectedImportFormat,
): d is {
  format: typeof ImportBatchFormat.PDF_BANRISUL_CC
  extractedText: string
} {
  return d.format === ImportBatchFormat.PDF_BANRISUL_CC
}

export function isCresolPdfFormat(
  d: DetectedImportFormat,
): d is {
  format: typeof ImportBatchFormat.PDF_CRESOL_STATEMENT
  extractedText: string
} {
  return d.format === ImportBatchFormat.PDF_CRESOL_STATEMENT
}

export async function detectImportFormat(
  fileName: string,
  buffer: Buffer,
): Promise<DetectedImportFormat> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) {
    return { format: ImportBatchFormat.CSV }
  }
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) {
    return { format: ImportBatchFormat.OFX }
  }
  if (lower.endsWith('.pdf')) {
    let text: string
    try {
      ;({ text } = await extractTextFromPdfBuffer(buffer, {
        errorPrefix: 'Statement PDF',
      }))
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      if (
        /too short|no text extracted|empty buffer|text extraction failed/i.test(
          raw,
        )
      ) {
        throw new BadRequestException(
          'This PDF could not be read as usable text. It may be image-only, encrypted, or damaged. ' +
            'Export a text-selectable statement from your bank, or use CSV/OFX.',
        )
      }
      throw new BadRequestException(`Could not read this PDF: ${raw}`)
    }

    const banrisulLayout = canParseBanrisulCreditCardPdf(text)
    if (banrisulLayout.ok) {
      return {
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        extractedText: text,
      }
    }

    const cresolLayout = canParseCresolStatementPdf(text)
    if (cresolLayout.ok) {
      return {
        format: ImportBatchFormat.PDF_CRESOL_STATEMENT,
        extractedText: text,
      }
    }

    throw new BadRequestException(
      'This PDF is not a supported bank statement. ' +
        'Supported text-based PDFs: Banrisul credit card, Cresol account. ' +
        'Use CSV or OFX for other banks.',
    )
  }
  throw new BadRequestException(
    'Unsupported file type. Use .csv, .ofx, .qfx, or a supported bank statement .pdf.',
  )
}
