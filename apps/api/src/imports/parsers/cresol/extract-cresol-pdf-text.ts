/**
 * Text-only extraction for Cresol statement PDFs (no OCR).
 * Delegates to the shared pdf-parse pipeline with Cresol-specific error labels.
 */

import {
  extractTextFromPdfBuffer,
  type ExtractBanrisulPdfTextResult,
} from '../banrisul-cc/extract-pdf-text'

const CRESOL_PDF_ERROR_PREFIX = 'Cresol PDF'

/**
 * Extract plain text from a Cresol PDF buffer.
 * Throws with a `Cresol PDF:` prefix when the buffer is unusable or text is too weak.
 */
export async function extractCresolStatementPdfText(
  buffer: Buffer,
): Promise<ExtractBanrisulPdfTextResult> {
  return extractTextFromPdfBuffer(buffer, {
    errorPrefix: CRESOL_PDF_ERROR_PREFIX,
  })
}
