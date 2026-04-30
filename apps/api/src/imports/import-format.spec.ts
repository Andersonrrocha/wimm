import { ImportBatchFormat } from '@prisma/client'
import {
  detectImportFormat,
  isBanrisulPdfFormat,
  isCresolPdfFormat,
} from './import-format'
import { buildPdfBufferFromPlainText } from './parsers/banrisul-cc/build-pdf-fixture'

function banrisulPdfBody(): string {
  return `
FATURA CARTÃO BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'note '.repeat(30)}
`.trim()
}

function cresolPdfBody(): string {
  return `
CRESOL
Extrato de Conta Corrente
Cooperativa Teste
Agência 0001

01/04/2025 PIX DEBITO PARA: FULANO - R$ 25,00
${'note '.repeat(30)}
`.trim()
}

describe('detectImportFormat', () => {
  it('returns CSV for .csv', async () => {
    await expect(detectImportFormat('a.csv', Buffer.from('a,b'))).resolves.toEqual(
      { format: ImportBatchFormat.CSV },
    )
  })

  it('returns OFX for .ofx and .qfx', async () => {
    await expect(
      detectImportFormat('b.ofx', Buffer.from('OFX')),
    ).resolves.toEqual({ format: ImportBatchFormat.OFX })
    await expect(
      detectImportFormat('c.qfx', Buffer.from('OFX')),
    ).resolves.toEqual({ format: ImportBatchFormat.OFX })
  })

  it('detects Banrisul credit card PDF and returns pre-extracted text', async () => {
    const buf = await buildPdfBufferFromPlainText(banrisulPdfBody())
    const r = await detectImportFormat('stmt.pdf', buf)
    expect(r.format).toBe(ImportBatchFormat.PDF_BANRISUL_CC)
    expect(isBanrisulPdfFormat(r)).toBe(true)
    if (!isBanrisulPdfFormat(r)) {
      throw new Error('expected Banrisul PDF detection')
    }
    expect(r.extractedText.length).toBeGreaterThan(80)
    expect(r.extractedText).toMatch(/LOJA/i)
    expect(r.extractedText).toMatch(/HIST/i)
  })

  it('detects Cresol account PDF and returns pre-extracted text', async () => {
    const buf = await buildPdfBufferFromPlainText(cresolPdfBody())
    const r = await detectImportFormat('cresol.pdf', buf)
    expect(r.format).toBe(ImportBatchFormat.PDF_CRESOL_STATEMENT)
    expect(isCresolPdfFormat(r)).toBe(true)
    if (!isCresolPdfFormat(r)) {
      throw new Error('expected Cresol PDF detection')
    }
    expect(r.extractedText).toMatch(/PIX DEBITO/i)
  })

  it('rejects PDFs that do not match any supported bank layout', async () => {
    const body = `
This is a generic PDF with enough text to pass minimum extraction length.
No credit card statement markers here. Just padding content repeated.
${'line '.repeat(40)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    await expect(detectImportFormat('other.pdf', buf)).rejects.toThrow(
      /not a supported bank statement/i,
    )
  })

  it('rejects PDF when extracted text is too short', async () => {
    const buf = await buildPdfBufferFromPlainText('a\n'.repeat(3))
    await expect(detectImportFormat('x.pdf', buf)).rejects.toThrow(
      /could not be read as usable text/i,
    )
  })

  it('rejects PDF with partial markers but missing TOTAL DE GASTOS', async () => {
    const body = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
${'pad '.repeat(35)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    await expect(detectImportFormat('partial.pdf', buf)).rejects.toThrow(
      /not a supported bank statement/i,
    )
  })

  it('rejects unknown extensions', async () => {
    await expect(detectImportFormat('x.xls', Buffer.from('a'))).rejects.toThrow(
      /Unsupported file type/i,
    )
  })
})
