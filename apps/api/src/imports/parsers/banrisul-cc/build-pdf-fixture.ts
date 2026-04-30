/**
 * Build minimal text-based PDFs for Banrisul parser tests only (pdf-lib).
 * Excluded from production build via tsconfig.build.json.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Lay out plain text line-by-line for predictable text extraction order. */
export async function buildPdfBufferFromPlainText(body: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  let page = doc.addPage([612, 792])
  let y = 750
  const lineHeight = 12
  const margin = 40
  const maxCharsPerLine = 90

  for (const rawLine of body.split(/\n/)) {
    if (y < 72) {
      page = doc.addPage([612, 792])
      y = 750
    }
    const line =
      rawLine.length > maxCharsPerLine
        ? rawLine.slice(0, maxCharsPerLine)
        : rawLine
    page.drawText(line.length > 0 ? line : ' ', {
      x: margin,
      y,
      font,
      size: 9,
    })
    y -= lineHeight
  }

  return Buffer.from(await doc.save())
}
