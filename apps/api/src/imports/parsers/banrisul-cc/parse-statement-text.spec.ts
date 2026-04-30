import { parseBanrisulStatementFromText } from './parse-statement-text'

const TWO_CARD_FIXTURE = `
FATURA CARTÃO BANRISUL
Data Documento 06/04/2026
Vencimento 06/04/2026

HISTÓRICO DE TRANSAÇÕES

ANDERSON - NR. 1570
26/02 MERCADOLIVRE 5PRODU 01/05 JACI BR 108,92
this is not a transaction line
27/02 EBN SONYPLAYSTA 01/04 CURITIBA BR 117,06
TOTAL DE GASTOS 225,98

ANDERSON  -  NR.  5112
15/03 PADARIA DO CENTRO BR 12,50
TOTAL DE GASTOS 12,50
`

describe('parseBanrisulStatementFromText', () => {
  it('parses two card sections with installment and non-installment lines', () => {
    const r = parseBanrisulStatementFromText(TWO_CARD_FIXTURE)

    expect(r.statementDate.toISOString().startsWith('2026-04-06')).toBe(true)
    expect(r.transactions).toHaveLength(3)

    const [t1, t2, t3] = r.transactions
    expect(t1.cardLast4).toBe('1570')
    expect(t1.transactionDate.toISOString().startsWith('2026-02-26')).toBe(true)
    expect(t1.merchantRaw).toBe('MERCADOLIVRE 5PRODU')
    expect(t1.amount).toBe(108.92)
    expect(t1.installmentCurrent).toBe(1)
    expect(t1.installmentTotal).toBe(5)
    expect(t1.confidence).toBe('high')

    expect(t2.cardLast4).toBe('1570')
    expect(t2.transactionDate.toISOString().startsWith('2026-02-27')).toBe(true)
    expect(t2.installmentCurrent).toBe(1)
    expect(t2.installmentTotal).toBe(4)

    expect(t3.cardLast4).toBe('5112')
    expect(t3.transactionDate.toISOString().startsWith('2026-03-15')).toBe(true)
    expect(t3.merchantRaw).toBe('PADARIA DO CENTRO')
    expect(t3.amount).toBe(12.5)
    expect(t3.installmentCurrent).toBeUndefined()
    expect(t3.installmentTotal).toBeUndefined()

    const badLineWarnings = r.warnings.filter((w) => w.code === 'line_parse_failed')
    expect(badLineWarnings).toHaveLength(1)
    expect(badLineWarnings[0].rawLine).toContain('not a transaction')
    expect(badLineWarnings[0].cardLast4).toBe('1570')

    expect(
      r.warnings.filter((w) => w.code === 'section_total_mismatch'),
    ).toHaveLength(0)
    expect(
      r.warnings.filter((w) => w.code === 'missing_declared_total'),
    ).toHaveLength(0)

    expect(r.statementBilling).toBeDefined()
    expect(
      r.statementBilling!.paymentDueDate.toISOString().startsWith('2026-04-06'),
    ).toBe(true)
    expect(
      r.statementBilling!.statementClosingDate?.toISOString().startsWith(
        '2026-04-06',
      ),
    ).toBe(true)
  })

  it('parses line with invalid installment NN/NN by ignoring it and emitting a warning', () => {
    const text = `
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA 13/05 BR 10,00
TOTAL DE GASTOS 10,00
`
    const r = parseBanrisulStatementFromText(text)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].merchantRaw).toBe('LOJA 13/05')
    expect(r.transactions[0].installmentCurrent).toBeUndefined()
    expect(r.transactions[0].installmentTotal).toBeUndefined()
    const ign = r.warnings.filter((w) => w.code === 'installment_ignored_invalid')
    expect(ign).toHaveLength(1)
    expect(r.statementBilling).toBeUndefined()
  })

  it('emits empty_section warning when a card has no lines before total', () => {
    const text = `
Data Documento 01/01/2026
HISTÓRICO DE TRANSAÇÕES
EMPTY - NR. 1000
TOTAL DE GASTOS 0,00
FULL - NR. 2000
10/01 LOJA BR 10,00
TOTAL DE GASTOS 10,00
`
    const r = parseBanrisulStatementFromText(text)
    expect(r.warnings.some((w) => w.code === 'empty_section')).toBe(true)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].cardLast4).toBe('2000')
  })

  it('throws when statement date is missing', () => {
    expect(() =>
      parseBanrisulStatementFromText(`
HISTÓRICO DE TRANSAÇÕES
X - NR. 1000
10/01 A BR 1,00
TOTAL DE GASTOS 1,00
`),
    ).toThrow(/not found/)
  })

  it('throws when no card sections exist', () => {
    expect(() =>
      parseBanrisulStatementFromText(`
Data Documento 01/01/2026
Sem histórico aqui
`),
    ).toThrow(/no card sections/)
  })

  it('continues after invalid_transaction_date for impossible calendar day', () => {
    const text = `
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
X - NR. 1000
29/02 LOJA BR 10,00
10/01 OK BR 5,00
TOTAL DE GASTOS 5,00
`
    const r = parseBanrisulStatementFromText(text)
    expect(r.warnings.some((w) => w.code === 'invalid_transaction_date')).toBe(
      true,
    )
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].merchantRaw).toBe('OK')
  })

  it('appends section_total_mismatch when declared total does not match parsed sum', () => {
    const text = `
Data Documento 01/01/2026
HISTÓRICO DE TRANSAÇÕES
X - NR. 1000
10/01 LOJA BR 10,00
TOTAL DE GASTOS 99,00
`
    const r = parseBanrisulStatementFromText(text)
    const m = r.warnings.filter((w) => w.code === 'section_total_mismatch')
    expect(m).toHaveLength(1)
    expect(m[0].cardLast4).toBe('1000')
    expect(m[0].expectedTotal).toBe(99)
    expect(m[0].actualTotal).toBe(10)
    expect(m[0].delta).toBeCloseTo(-89, 2)
  })

  it('appends missing_declared_total when a section has no TOTAL DE GASTOS', () => {
    const text = `
Data Documento 01/01/2026
HISTÓRICO DE TRANSAÇÕES
A - NR. 1111
10/01 X BR 10,00
B - NR. 2222
10/01 Y BR 5,00
TOTAL DE GASTOS 5,00
`
    const r = parseBanrisulStatementFromText(text)
    const m = r.warnings.filter((w) => w.code === 'missing_declared_total')
    expect(m).toHaveLength(1)
    expect(m[0].cardLast4).toBe('1111')
    expect(m[0].actualTotal).toBe(10)
  })

  it('validates two cards independently in one statement', () => {
    const text = `
Data Documento 01/01/2026
HISTÓRICO DE TRANSAÇÕES
A - NR. 1111
10/01 A BR 10,00
TOTAL DE GASTOS 10,00
B - NR. 2222
10/01 B BR 20,00
TOTAL DE GASTOS 50,00
`
    const r = parseBanrisulStatementFromText(text)
    const mismatches = r.warnings.filter((w) => w.code === 'section_total_mismatch')
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].cardLast4).toBe('2222')
  })
})
