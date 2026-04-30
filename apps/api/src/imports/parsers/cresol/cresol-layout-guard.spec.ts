import { canParseCresolStatementPdf } from './cresol-layout-guard'

const MIN_PAD = 'x'.repeat(120)

describe('canParseCresolStatementPdf', () => {
  it('accepts typical extrato markers', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Cooperativa Test
Agência 0001

15/03/2025 PIX DEBITO PARA: A - R$ 10,00
${MIN_PAD}
`.trim()
    expect(canParseCresolStatementPdf(text)).toEqual({ ok: true })
  })

  it('rejects without CRESOL', () => {
    const text = `
Extrato de Conta Corrente
Agência 1
01/01/2025 X - R$ 1,00
${MIN_PAD}
`.trim()
    expect(canParseCresolStatementPdf(text).ok).toBe(false)
  })

  it('rejects without signed BRL lines', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Cooperativa
Agência 1
Saldo do Dia
${MIN_PAD}
`.trim()
    expect(canParseCresolStatementPdf(text).ok).toBe(false)
  })
})
