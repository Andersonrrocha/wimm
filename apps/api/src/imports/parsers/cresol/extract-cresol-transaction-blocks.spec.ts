import { extractCresolTransactionBlocks } from './extract-cresol-transaction-blocks'

describe('extractCresolTransactionBlocks', () => {
  it('extracts single-line transactions', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 1

15/03/2025 PIX DEBITO PARA: JOAO - R$ 10,00
16/03/2025 SAQUE TAA 999 - R$ 20,00
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].transactionDateRaw).toBe('15/03/2025')
    expect(blocks[0].rawLines).toHaveLength(1)
    expect(blocks[0].rawBlock).toBe(blocks[0].rawLines.join('\n'))
    expect(blocks[0].rawLines[0]).toContain('PIX DEBITO')

    expect(blocks[1].transactionDateRaw).toBe('16/03/2025')
    expect(blocks[1].rawLines[0]).toContain('SAQUE TAA')
  })

  it('groups multiline PIX description into one block', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Agência 1

17/03/2025 PIX CREDITO DE: EMPRESA LTDA
COMPL NOME OU OBS
MAIS UMA LINHA
18/03/2025 OUTRA TX - R$ 1,00
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].transactionDateRaw).toBe('17/03/2025')
    expect(blocks[0].rawLines).toHaveLength(3)
    expect(blocks[0].rawBlock).toContain('PIX CREDITO')
    expect(blocks[0].rawBlock).toContain('MAIS UMA LINHA')

    expect(blocks[1].transactionDateRaw).toBe('18/03/2025')
  })

  it('includes debito automatico mastercard as one block', () => {
    const text = `
CRESOL
Extrato
Agência 1

19/03/2025 DEBITO AUTOMATICO FATURA MASTERCARD - R$ 1.548,66
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].transactionDateRaw).toBe('19/03/2025')
    expect(blocks[0].rawLines[0]).toContain('MASTERCARD')
  })

  it('includes IOF and juros entries', () => {
    const text = `
CRESOL
Extrato
Agência 1

20/03/2025 IOF SOBRE SALDO DEVEDOR - R$ 2,34
21/03/2025 JUROS DE CHEQUE ESPECIAL - R$ 0,99
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].rawLines[0]).toContain('IOF SOBRE SALDO DEVEDOR')
    expect(blocks[1].rawLines[0]).toContain('JUROS DE CHEQUE ESPECIAL')
  })

  it('drops noise lines and keeps transactions', () => {
    const text = `
CRESOL
Extrato de Conta Corrente
Saldo Anterior
Saldo do Dia 01/01/2025
Consulta Posição consolidada — extrato
Período de 01/03/2025 a 31/03/2025
Lançamentos

22/03/2025 PIX DEBITO PARA: X - R$ 5,00
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].transactionDateRaw).toBe('22/03/2025')
    expect(blocks[0].rawBlock).not.toContain('Saldo')
    expect(blocks[0].rawBlock).not.toContain('Período')
  })

  it('does not break blocks across page headers', () => {
    const text = `
CRESOL
Extrato
Agência 1

23/03/2025 PIX CREDITO DE: ACME
detalhe linha 2
Página 2 de 5
continua apos rodape
24/03/2025 PROXIMA - R$ 1,00
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].rawLines).toHaveLength(3)
    expect(blocks[0].rawLines.some((l) => l.includes('continua'))).toBe(true)
    expect(blocks[0].rawLines.some((l) => /PAG(INA)?\s*\d/i.test(l))).toBe(
      false,
    )
    expect(blocks[1].transactionDateRaw).toBe('24/03/2025')
  })

  it('ignores leading orphan lines until first dated transaction', () => {
    const text = `
header sem data
outra linha

25/03/2025 SO TEM ISSO - R$ 1,00
`.trim()

    const blocks = extractCresolTransactionBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].transactionDateRaw).toBe('25/03/2025')
  })
})
