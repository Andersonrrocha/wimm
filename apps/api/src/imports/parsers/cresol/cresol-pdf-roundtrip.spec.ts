import { buildPdfBufferFromPlainText } from '../banrisul-cc/build-pdf-fixture'
import { extractCresolStatementPdfText } from './extract-cresol-pdf-text'
import { parseCresolStatementFromExtractedText } from './parse-cresol-statement-extracted-text'

describe('Cresol PDF text roundtrip', () => {
  it('extracts lines compatible with the text parser', async () => {
    const body = `
CRESOL
Extrato de Conta Corrente
Agência 0001

01/04/2025 X - R$ 1,00
${'pad '.repeat(50)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const { text } = await extractCresolStatementPdfText(buf)
    expect(text).toContain('CRESOL')
    expect(text).toContain('01/04/2025')
    expect(text).toMatch(/-\s*R\$\s*1,00/)
    const r = parseCresolStatementFromExtractedText(text)
    expect(r.transactions.length).toBeGreaterThanOrEqual(1)
    expect(r.transactions[0].signedAmount).toBe(-1)
  })
})
