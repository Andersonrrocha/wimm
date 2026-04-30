import { buildPdfBufferFromPlainText } from './build-pdf-fixture'
import { parseBanrisulCreditCardStatementPdf } from './parse-statement-pdf'
import { parseBanrisulStatementFromText } from './parse-statement-text'

/** Same layout as parse-statement-text integration fixture (ASCII-friendly for pdf-lib). */
const TWO_CARD_STATEMENT_TEXT = `
FATURA CARTAO BANRISUL
Data Documento 06/04/2026
Vencimento 06/04/2026

HISTORICO DE TRANSACOES

ANDERSON - NR. 1570
26/02 MERCADOLIVRE 5PRODU 01/05 JACI BR 108,92
this is not a transaction line
27/02 EBN SONYPLAYSTA 01/04 CURITIBA BR 117,06
TOTAL DE GASTOS 225,98

ANDERSON  -  NR.  5112
15/03 PADARIA DO CENTRO BR 12,50
TOTAL DE GASTOS 12,50
`

describe('parseBanrisulCreditCardStatementPdf', () => {
  it('throws on empty buffer', async () => {
    await expect(
      parseBanrisulCreditCardStatementPdf(Buffer.alloc(0)),
    ).rejects.toThrow(/empty buffer/)
  })

  it('throws on non-text-friendly PDF content', async () => {
    const buf = await buildPdfBufferFromPlainText('tiny')
    await expect(parseBanrisulCreditCardStatementPdf(buf)).rejects.toThrow(
      /too short/,
    )
  })

  it('extracts text and matches text-only parser output', async () => {
    const buf = await buildPdfBufferFromPlainText(TWO_CARD_STATEMENT_TEXT)
    const fromPdf = await parseBanrisulCreditCardStatementPdf(buf)
    const fromText = parseBanrisulStatementFromText(TWO_CARD_STATEMENT_TEXT)

    expect(fromPdf.transactions).toEqual(fromText.transactions)
    expect(fromPdf.statementDate.toISOString()).toBe(
      fromText.statementDate.toISOString(),
    )
    expect(fromPdf.warnings.map((w) => w.code)).toEqual(
      fromText.warnings.map((w) => w.code),
    )
  })

  it('rejects PDF text that fails Banrisul layout guard', async () => {
    const body = `
This PDF has enough characters for extraction but is not a Banrisul statement.
${'padding line\n'.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    await expect(parseBanrisulCreditCardStatementPdf(buf)).rejects.toThrow(
      /incompatible layout/i,
    )
  })
})
