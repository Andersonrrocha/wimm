/**
 * Cresol statement PDF buffer → same result as {@link parseCresolStatementFromExtractedText}.
 *
 * The import pipeline runs text extraction once in {@link detectImportFormat} and reuses that
 * string with the text parser — prefer that path in preview/commit to avoid parsing the PDF twice.
 * This function is for standalone PDF → result (tests, tooling).
 */

import { extractCresolStatementPdfText } from './extract-cresol-pdf-text'
import {
  parseCresolStatementFromExtractedText,
  type CresolExtractedTextParseResult,
} from './parse-cresol-statement-extracted-text'

export type { CresolExtractedTextParseResult }

/**
 * Extract text from a text-based PDF, then run the Cresol statement text parser.
 * Throws if the PDF buffer is empty, invalid, or yields insufficient text (see {@link extractCresolStatementPdfText}).
 */
export async function parseCresolStatementPdf(
  buffer: Buffer,
): Promise<CresolExtractedTextParseResult> {
  const { text } = await extractCresolStatementPdfText(buffer)
  return parseCresolStatementFromExtractedText(text)
}
