import {
  extractBanrisulStatementBillingSnapshot,
  extractBanrisulStatementDate,
} from './statement-date'

describe('extractBanrisulStatementDate', () => {
  it('parses Data Documento with spaces', () => {
    const text = `FATURA CARTÃO
Data Documento 06/04/2026
Outros dados`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('06/04/2026')
    expect(r.statementDate.toISOString().startsWith('2026-04-06')).toBe(true)
  })

  it('parses Vencimento with colon', () => {
    const text = `Vencimento: 06/04/2026`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('06/04/2026')
    expect(r.statementDate.getUTCDate()).toBe(6)
    expect(r.statementDate.getUTCMonth()).toBe(3)
    expect(r.statementDate.getUTCFullYear()).toBe(2026)
  })

  it('prefers Data Documento over Vencimento when both present', () => {
    const text = `
Vencimento 05/04/2026
Data Documento 01/04/2026
`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('01/04/2026')
    expect(r.statementDate.getUTCMonth()).toBe(3)
    expect(r.statementDate.getUTCDate()).toBe(1)
  })

  it('uses first Data Documento when multiple appear', () => {
    const text = `
Data Documento 10/03/2026
...
Data Documento 10/04/2026
`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('10/03/2026')
  })

  it('falls back to Vencimento when Data Documento is absent', () => {
    const text = `Resumo
Vencimento   15/05/2026
`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('15/05/2026')
  })

  it('matches case-insensitive labels', () => {
    const r = extractBanrisulStatementDate('data documento 06/04/2026')
    expect(r.rawMatch).toBe('06/04/2026')
  })

  it('tolerates newline between label and date', () => {
    const text = `Data Documento
06/04/2026`
    const r = extractBanrisulStatementDate(text)
    expect(r.rawMatch).toBe('06/04/2026')
  })

  it('throws when no date field is present', () => {
    expect(() =>
      extractBanrisulStatementDate('Fatura sem datas úteis 99'),
    ).toThrow(/not found/)
  })

  it('throws on invalid calendar date in matched field', () => {
    expect(() =>
      extractBanrisulStatementDate('Data Documento 31/04/2026'),
    ).toThrow(/Invalid calendar date/)
  })

  it('throws on impossible day', () => {
    expect(() =>
      extractBanrisulStatementDate('Vencimento: 32/01/2026'),
    ).toThrow(/Invalid Banrisul date values/)
  })

  it('throws on year out of range', () => {
    expect(() =>
      extractBanrisulStatementDate('Data Documento 01/01/1999'),
    ).toThrow(/Invalid Banrisul date values/)
  })
})

describe('extractBanrisulStatementBillingSnapshot', () => {
  it('returns payment due and optional document date when Vencimento exists', () => {
    const text = `
Data Documento 01/04/2026
Vencimento 06/04/2026
`
    const r = extractBanrisulStatementBillingSnapshot(text)
    expect(r).not.toBeNull()
    expect(r!.paymentDueDate.toISOString().startsWith('2026-04-06')).toBe(true)
    expect(r!.statementClosingDate?.toISOString().startsWith('2026-04-01')).toBe(
      true,
    )
  })

  it('returns due only when document date absent', () => {
    const r = extractBanrisulStatementBillingSnapshot('Vencimento 15/05/2026')
    expect(r).not.toBeNull()
    expect(r!.paymentDueDate.getUTCDate()).toBe(15)
    expect(r!.paymentDueDate.getUTCMonth()).toBe(4)
    expect(r!.statementClosingDate).toBeUndefined()
  })

  it('returns null when Vencimento is missing', () => {
    expect(
      extractBanrisulStatementBillingSnapshot('Data Documento 06/04/2026'),
    ).toBeNull()
  })
})
