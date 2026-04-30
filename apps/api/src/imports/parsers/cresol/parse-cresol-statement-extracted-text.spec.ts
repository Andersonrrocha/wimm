import { parseCresolStatementFromExtractedText } from './parse-cresol-statement-extracted-text'

const PAD = 'x'.repeat(120)

const LEGACY_FULL_FIXTURE = `
CRESOL Confederação
Extrato de Conta Corrente
Cooperativa Demonstração
Agência 1234 Conta 567890-1

Saldo Anterior
Consulta Posição consolidada — ignorar

Saldo do Dia 01/01/2025

15/03/2025 PIX DEBITO PARA: JOAO SILVA - R$ 360,00

16/03/2025 PIX CREDITO DE: EMPRESA LTDA
OUTRA LINHA DETALHE
+ R$ 63,48

17/03/2025 SAQUE TAA 123456 - R$ 150,00

18/03/2025 DEBITO AUTOMATICO FATURA MASTERCARD - R$ 1.548,66

19/03/2025 IOF S/ OPERACOES - R$ 2,34

20/03/2025 JUROS SALDO DEVEDOR - R$ 0,99

DATA
HISTORICO
VALOR
`.trim()

describe('parseCresolStatementFromExtractedText', () => {
  it('parses rich extrato fixture (PIX, multiline credit, saque, IOF, juros)', () => {
    const r = parseCresolStatementFromExtractedText(
      `${LEGACY_FULL_FIXTURE}\n${PAD}`,
    )

    expect(r.transactions).toHaveLength(6)
    expect(r.transactions[0]).toMatchObject({
      description: 'PIX DEBITO PARA: JOAO SILVA',
      signedAmount: -360,
    })
    expect(r.transactions[1]).toMatchObject({
      description: 'PIX CREDITO DE: EMPRESA LTDA OUTRA LINHA DETALHE',
      signedAmount: 63.48,
    })
    expect(r.transactions[2].description).toBe('SAQUE TAA 123456')
    expect(r.transactions[2].signedAmount).toBe(-150)
    expect(r.transactions[3].signedAmount).toBe(-1548.66)
    expect(r.transactions[4].signedAmount).toBe(-2.34)
    expect(r.transactions[5].signedAmount).toBe(-0.99)
  })

  it('parses multiple transactions from a valid statement text', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 0001

15/03/2025 PIX DEBITO PARA: JOAO - R$ 360,00
16/03/2025 PIX CREDITO DE: EMPRESA + R$ 63,48
17/03/2025 SAQUE TAA 999 - R$ 150,00
${PAD}
`.trim()

    const r = parseCresolStatementFromExtractedText(text)

    expect(r.warnings.filter((w) => w.code === 'unsupported_layout')).toHaveLength(
      0,
    )
    expect(r.warnings.filter((w) => w.code === 'block_parse_failed')).toHaveLength(
      0,
    )
    expect(r.transactions).toHaveLength(3)
    expect(r.transactions[0].signedAmount).toBe(-360)
    expect(r.transactions[1].signedAmount).toBe(63.48)
    expect(r.transactions[2].signedAmount).toBe(-150)
    expect(r.transactions.every((t) => t.rawBlock.length > 0)).toBe(true)
  })

  it('continues after a malformed block and emits block_parse_failed', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 0001

18/03/2025 OK LINE - R$ 10,00
19/03/2025 SEM VALOR SÓ TEXTO CONTINUA
20/03/2025 OUTRA OK - R$ 5,00
${PAD}
`.trim()

    const r = parseCresolStatementFromExtractedText(text)

    expect(r.transactions).toHaveLength(2)
    expect(r.warnings.some((w) => w.code === 'block_parse_failed')).toBe(true)
    const failed = r.warnings.filter((w) => w.code === 'block_parse_failed')
    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(failed[0].rawBlock).toBeDefined()
    expect(r.warnings.some((w) => w.code === 'empty_result')).toBe(false)
  })

  it('returns unsupported_layout when text is not a Cresol statement', () => {
    const text = `
Not a bank statement at all.
Just filler to pass minimum length if needed.
${PAD}
`.trim()

    const r = parseCresolStatementFromExtractedText(text)

    expect(r.transactions).toHaveLength(0)
    expect(r.warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported_layout',
        message: expect.stringMatching(/CRESOL|not appear/i),
      }),
    ])
  })

  it('returns empty_result when layout passes but no transaction blocks are found', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 0001

Some footer or note - R$ 1,00
${PAD}
`.trim()

    const r = parseCresolStatementFromExtractedText(text)

    expect(r.transactions).toHaveLength(0)
    expect(r.warnings.some((w) => w.code === 'empty_result')).toBe(true)
    expect(r.warnings.some((w) => w.code === 'unsupported_layout')).toBe(false)
  })

  it('creates two blocks when a second dated line follows the first (same calendar date)', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 1

10/04/2025 FIRST TX - R$ 10,00
10/04/2025 SECOND TX - R$ 5,00
${PAD}
`.trim()
    const r = parseCresolStatementFromExtractedText(text)
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions[0].signedAmount).toBe(-10)
    expect(r.transactions[1].signedAmount).toBe(-5)
  })

  it('ignores trailing description lines after the amount within the same block', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 1

11/05/2025 OK - R$ 1,00
orphan without amount
${PAD}
`.trim()
    const r = parseCresolStatementFromExtractedText(text)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].signedAmount).toBe(-1)
    expect(r.transactions[0].rawBlock).toContain('orphan')
    expect(r.warnings.filter((w) => w.code === 'block_parse_failed')).toHaveLength(
      0,
    )
  })

  it('does not split continuation lines without a leading date into a second transaction', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 1

10/04/2025 FIRST TX - R$ 10,00
SECOND TX NO DATE - R$ 5,00
${PAD}
`.trim()
    const r = parseCresolStatementFromExtractedText(text)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].signedAmount).toBe(-5)
    expect(r.transactions[0].description).toContain('SECOND TX NO DATE')
  })

  it('emits low_confidence_block when keyword and amount sign disagree', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 0001

21/03/2025 PIX CREDITO DE: X - R$ 1,00
${PAD}
`.trim()

    const r = parseCresolStatementFromExtractedText(text)

    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].confidence).toBe('low')
    expect(r.transactions[0].signedAmount).toBe(1)
    expect(r.warnings.some((w) => w.code === 'low_confidence_block')).toBe(true)
  })
})
