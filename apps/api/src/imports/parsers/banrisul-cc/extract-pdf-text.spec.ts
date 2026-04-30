import { buildPdfBufferFromPlainText } from './build-pdf-fixture'
import {
  BANRISUL_PDF_MIN_TEXT_CHARS,
  extractTextFromPdfBuffer,
} from './extract-pdf-text'

describe('extractTextFromPdfBuffer', () => {
  it('throws on empty buffer', async () => {
    await expect(extractTextFromPdfBuffer(Buffer.alloc(0))).rejects.toThrow(
      /Statement PDF: empty buffer/,
    )
  })

  it('throws when PDF bytes are invalid', async () => {
    await expect(
      extractTextFromPdfBuffer(Buffer.from('%PDF-1.4\n%not a real pdf')),
    ).rejects.toThrow(/Statement PDF: text extraction failed/)
  })

  it('throws when extracted text is shorter than minimum', async () => {
    const buf = await buildPdfBufferFromPlainText('short\n'.repeat(5))
    await expect(extractTextFromPdfBuffer(buf)).rejects.toThrow(
      /Statement PDF: extracted text is too short/,
    )
  })

  it('returns text for a generated text-based PDF', async () => {
    const body = 'Statement line one\n'.repeat(25)
    const buf = await buildPdfBufferFromPlainText(body)
    const r = await extractTextFromPdfBuffer(buf)
    expect(r.text.trim().length).toBeGreaterThanOrEqual(BANRISUL_PDF_MIN_TEXT_CHARS)
    expect(r.text).toContain('Statement line one')
  })
})
