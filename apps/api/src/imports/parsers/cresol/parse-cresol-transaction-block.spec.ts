import type { CresolTransactionBlockCandidate } from './extract-cresol-transaction-blocks'
import { parseCresolTransactionBlock } from './parse-cresol-transaction-block'

function block(
  transactionDateRaw: string,
  rawLines: string[],
): CresolTransactionBlockCandidate {
  return {
    transactionDateRaw,
    rawLines,
    rawBlock: rawLines.join('\n'),
  }
}

describe('parseCresolTransactionBlock', () => {
  it('parses PIX debit (keyword + amount sign)', () => {
    const b = block('15/03/2025', [
      '15/03/2025 PIX DEBITO PARA: JOAO SILVA - R$ 360,00',
    ])
    const r = parseCresolTransactionBlock(b)
    expect(r).not.toBeNull()
    expect(r!.occurredAt.toISOString().startsWith('2025-03-15')).toBe(true)
    expect(r!.signedAmount).toBe(-360)
    expect(r!.description).toContain('PIX DEBITO PARA: JOAO SILVA')
    expect(r!.description).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(r!.description).not.toContain('R$')
    expect(r!.confidence).toBe('high')
  })

  it('parses PIX credit', () => {
    const b = block('16/03/2025', [
      '16/03/2025 PIX CREDITO DE: EMPRESA LTDA + R$ 63,48',
    ])
    const r = parseCresolTransactionBlock(b)
    expect(r!.signedAmount).toBe(63.48)
    expect(r!.description).toContain('PIX CREDITO DE: EMPRESA LTDA')
    expect(r!.confidence).toBe('high')
  })

  it('parses saque', () => {
    const b = block('17/03/2025', [
      '17/03/2025 SAQUE TAA 123456 - R$ 150,00',
    ])
    const r = parseCresolTransactionBlock(b)
    expect(r!.signedAmount).toBe(-150)
    expect(r!.description).toContain('SAQUE TAA')
    expect(r!.confidence).toBe('high')
  })

  it('parses debito automatico mastercard', () => {
    const b = block('18/03/2025', [
      '18/03/2025 DEBITO AUTOMATICO FATURA MASTERCARD - R$ 1.548,66',
    ])
    const r = parseCresolTransactionBlock(b)
    expect(r!.signedAmount).toBe(-1548.66)
    expect(r!.description).toContain('DEBITO AUTOMATICO FATURA MASTERCARD')
    expect(r!.confidence).toBe('high')
  })

  it('parses IOF and juros as debit via keyword', () => {
    const iof = block('19/03/2025', [
      '19/03/2025 IOF SOBRE SALDO DEVEDOR - R$ 2,34',
    ])
    expect(parseCresolTransactionBlock(iof)!.signedAmount).toBe(-2.34)

    const juros = block('20/03/2025', [
      '20/03/2025 JUROS DE CHEQUE ESPECIAL - R$ 0,99',
    ])
    expect(parseCresolTransactionBlock(juros)!.signedAmount).toBe(-0.99)
  })

  it('parses multiline block with amount on last line only', () => {
    const b = block('21/03/2025', [
      '21/03/2025 PIX CREDITO DE: ACME LTDA',
      'LINHA COMPLEMENTAR',
      '+ R$ 10,00',
    ])
    const r = parseCresolTransactionBlock(b)
    expect(r!.signedAmount).toBe(10)
    expect(r!.description).toBe(
      'PIX CREDITO DE: ACME LTDA LINHA COMPLEMENTAR',
    )
    expect(r!.confidence).toBe('high')
  })

  it('returns low confidence when keyword intent disagrees with amount sign', () => {
    const b = block('22/03/2025', [
      '22/03/2025 PIX CREDITO DE: X + R$ 5,00',
    ])
    const tampered = {
      ...b,
      rawLines: ['22/03/2025 PIX CREDITO DE: X - R$ 5,00'],
      rawBlock: '22/03/2025 PIX CREDITO DE: X - R$ 5,00',
    }
    const r = parseCresolTransactionBlock(tampered)
    expect(r!.signedAmount).toBe(5)
    expect(r!.confidence).toBe('low')
  })

  it('uses amount sign with high confidence when no keyword matches', () => {
    const b = block('23/03/2025', ['23/03/2025 ALGUMA COISA - R$ 7,00'])
    const r = parseCresolTransactionBlock(b)
    expect(r!.signedAmount).toBe(-7)
    expect(r!.confidence).toBe('high')
  })

  it('returns null for invalid date', () => {
    const b = block('99/99/2025', ['99/99/2025 X - R$ 1,00'])
    expect(parseCresolTransactionBlock(b)).toBeNull()
  })

  it('returns null when amount is missing', () => {
    const b = block('24/03/2025', ['24/03/2025 SEM VALOR SO TEXTO'])
    expect(parseCresolTransactionBlock(b)).toBeNull()
  })

  it('returns null when description would be empty', () => {
    const b = block('25/03/2025', ['25/03/2025 - R$ 1,00'])
    expect(parseCresolTransactionBlock(b)).toBeNull()
  })
})
