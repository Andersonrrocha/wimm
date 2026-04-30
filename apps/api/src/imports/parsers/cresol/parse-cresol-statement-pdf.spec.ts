import { buildPdfBufferFromPlainText } from '../banrisul-cc/build-pdf-fixture'
import { extractCresolStatementPdfText } from './extract-cresol-pdf-text'
import { parseCresolStatementFromExtractedText } from './parse-cresol-statement-extracted-text'
import { parseCresolStatementPdf } from './parse-cresol-statement-pdf'

const PAD = 'x'.repeat(120)

function cresolStatementBody(): string {
  return `
CRESOL
Extrato de Conta Corrente
Agência 0001

15/03/2025 PIX DEBITO PARA: JOAO - R$ 360,00
16/03/2025 PIX CREDITO DE: EMPRESA + R$ 63,48
${PAD}
`.trim()
}

describe('parseCresolStatementPdf', () => {
  it('extracts text and parses transactions from a text-based PDF', async () => {
    const buf = await buildPdfBufferFromPlainText(cresolStatementBody())
    const r = await parseCresolStatementPdf(buf)

    expect(r.warnings.filter((w) => w.code === 'unsupported_layout')).toHaveLength(
      0,
    )
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions[0].signedAmount).toBe(-360)
    expect(r.transactions[1].signedAmount).toBe(63.48)
  })

  it('matches parseCresolStatementFromExtractedText on the same extracted string (delegation)', async () => {
    const buf = await buildPdfBufferFromPlainText(cresolStatementBody())
    const { text } = await extractCresolStatementPdfText(buf)
    const fromPdf = await parseCresolStatementPdf(buf)
    const fromText = parseCresolStatementFromExtractedText(text)

    expect(fromPdf).toEqual(fromText)
  })

  it('throws on empty buffer with Cresol error prefix', async () => {
    await expect(parseCresolStatementPdf(Buffer.alloc(0))).rejects.toThrow(
      /Cresol PDF: empty buffer/,
    )
  })

  it('throws on invalid PDF bytes', async () => {
    await expect(
      parseCresolStatementPdf(Buffer.from('%PDF-1.4\n%not a real pdf')),
    ).rejects.toThrow(/Cresol PDF: text extraction failed/)
  })

  it('throws when extracted text is below minimum length', async () => {
    const buf = await buildPdfBufferFromPlainText('short\n'.repeat(5))
    await expect(parseCresolStatementPdf(buf)).rejects.toThrow(
      /Cresol PDF: extracted text is too short/,
    )
  })
})

describe('extractCresolStatementPdfText', () => {
  it('uses Cresol-specific error messages', async () => {
    await expect(extractCresolStatementPdfText(Buffer.alloc(0))).rejects.toThrow(
      /Cresol PDF: empty buffer/,
    )
  })
})
