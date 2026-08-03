/**
 * Import file format detection (CSV, OFX, bank-specific PDFs).
 *
 * Selection is delegated to the parser registry (`./import-parser-registry`):
 * this module's own job is narrowed to the one-time PDF text extraction
 * (shared across every content-sniffing PDF parser) and translating a
 * registry match into the `DetectedImportFormat` shape callers already
 * depend on.
 */

import { BadRequestException } from '@nestjs/common'
import { ImportBatchFormat } from '@wimm/shared'
import { extractTextFromPdfBuffer } from './parsers/banrisul-cc/extract-pdf-text'
import { findParsersForFileName } from './import-parser-registry'

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
  const candidates = findParsersForFileName(fileName)

  const directMatch = candidates.find((p) => !p.needsExtractedText)
  if (directMatch) {
    return { format: directMatch.format } as DetectedImportFormat
  }

  const sniffedCandidates = candidates.filter((p) => p.needsExtractedText)
  if (sniffedCandidates.length > 0) {
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

    for (const parser of sniffedCandidates) {
      const match = parser.canHandle({ buffer, extractedText: text })
      if (match.ok) {
        return {
          format: parser.format,
          extractedText: text,
        } as DetectedImportFormat
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
