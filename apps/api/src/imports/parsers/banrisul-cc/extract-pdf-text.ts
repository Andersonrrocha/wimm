/**
 * Text-only PDF extraction for statement PDFs (no OCR).
 * Default {@link ExtractStatementPdfTextOptions.errorPrefix} is neutral (`Statement PDF`).
 * Bank-specific entrypoints pass explicit prefixes (e.g. Banrisul, Cresol).
 * Uses pdf-parse v2 (pdf.js). Jest runs with NODE_OPTIONS=--experimental-vm-modules (see api package.json).
 */

import { PDFParse } from 'pdf-parse'

/** Minimum trimmed length to treat extraction as usable (avoids image-only / junk buffers). */
export const BANRISUL_PDF_MIN_TEXT_CHARS = 120

export type ExtractBanrisulPdfTextResult = {
  /** Raw extracted string from the PDF engine (may include trailing spaces per page). */
  text: string
}

export type ExtractStatementPdfTextOptions = {
  /** Prefix for error messages (default: `Statement PDF`). */
  errorPrefix?: string
}

/**
 * Extract plain text from a PDF buffer. Throws if the buffer is empty, invalid, has no text,
 * or text is shorter than {@link BANRISUL_PDF_MIN_TEXT_CHARS} after trim.
 */
export async function extractTextFromPdfBuffer(
  buffer: Buffer,
  options?: ExtractStatementPdfTextOptions,
): Promise<ExtractBanrisulPdfTextResult> {
  const prefix = options?.errorPrefix ?? 'Statement PDF'

  if (!buffer?.length) {
    throw new Error(`${prefix}: empty buffer`)
  }

  let rawText: string
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    rawText = typeof result.text === 'string' ? result.text : ''
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`${prefix}: text extraction failed (${msg})`)
  } finally {
    try {
      await parser.destroy()
    } catch {
      /* ignore cleanup errors */
    }
  }

  const trimmed = rawText.trim()
  if (trimmed.length === 0) {
    throw new Error(
      `${prefix}: no text extracted (image-only, corrupted, or encrypted PDF); OCR is not supported`,
    )
  }
  if (trimmed.length < BANRISUL_PDF_MIN_TEXT_CHARS) {
    throw new Error(
      `${prefix}: extracted text is too short (${trimmed.length} chars, need at least ${BANRISUL_PDF_MIN_TEXT_CHARS}); not a usable text-based statement`,
    )
  }

  return { text: rawText }
}
