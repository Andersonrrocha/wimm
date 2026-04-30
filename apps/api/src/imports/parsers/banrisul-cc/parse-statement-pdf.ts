/**
 * Banrisul credit card statement — parse from PDF bytes (text extraction only, no OCR).
 * Does not integrate with ImportsService.
 */

import { extractTextFromPdfBuffer } from './extract-pdf-text'
import { canParseBanrisulCreditCardPdf } from './banrisul-layout-guard'
import {
  parseBanrisulStatementFromText,
  type BanrisulStatementParseResult,
} from './parse-statement-text'

export type { BanrisulStatementParseResult }

/**
 * Extract text from a PDF buffer, then run the Banrisul text parser.
 *
 * @throws If PDF text extraction fails or yields unusable text, or if the text parser throws
 * (e.g. missing statement date or card sections).
 */
export async function parseBanrisulCreditCardStatementPdf(
  buffer: Buffer,
): Promise<BanrisulStatementParseResult> {
  const { text } = await extractTextFromPdfBuffer(buffer, {
    errorPrefix: 'Banrisul PDF',
  })
  const layout = canParseBanrisulCreditCardPdf(text)
  if (!layout.ok) {
    throw new Error(`Banrisul PDF: incompatible layout — ${layout.message}`)
  }
  return parseBanrisulStatementFromText(text)
}
