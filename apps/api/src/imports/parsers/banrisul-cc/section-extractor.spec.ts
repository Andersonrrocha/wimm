import { extractBanrisulCardSections } from './section-extractor'

/** Fixture shaped like Banrisul PDF history (names/lines synthetic; layout realistic). */
const FIXTURE_TWO_CARDS = `
RESUMO DA FATURA

HISTÓRICO DE TRANSAÇÕES

Pág. 2/3

ANDERSON - NR. 1570
26/02 MERCADOLIVRE 5PRODU 01/05 JACI BR 108,92
27/02 EBN SONYPLAYSTA 01/04 CURITIBA BR 117,06

TOTAL DE GASTOS 1.139,69

ANDERSON  -  NR.  5112
10/03 AMAZON BR 01/06 SAO PAULO BR 100,00
15/03 LOJA XYZ BR 50,00

TOTAL DE GASTOS 623,61

Propaganda cartão
`

describe('extractBanrisulCardSections', () => {
  it('splits multiple card sections with totals from fixture-style text', () => {
    const sections = extractBanrisulCardSections(FIXTURE_TWO_CARDS)
    expect(sections).toHaveLength(2)

    expect(sections[0].cardLast4).toBe('1570')
    expect(sections[0].declaredTotal).toBe(1139.69)
    expect(sections[0].rawLines).toHaveLength(2)
    expect(sections[0].rawLines[0]).toContain('MERCADOLIVRE')
    expect(sections[0].rawLines[1]).toContain('SONYPLAYSTA')
    expect(sections[0].rawSectionText).toContain('ANDERSON - NR. 1570')
    expect(sections[0].rawSectionText).toContain('TOTAL DE GASTOS 1.139,69')

    expect(sections[1].cardLast4).toBe('5112')
    expect(sections[1].declaredTotal).toBe(623.61)
    expect(sections[1].rawLines).toHaveLength(2)
    expect(sections[1].rawLines[0]).toContain('AMAZON')
    expect(sections[1].rawSectionText).toContain('TOTAL DE GASTOS 623,61')
  })

  it('returns empty array when HISTÓRICO section is missing', () => {
    const text = `
FATURA CARTÃO
ANDERSON - NR. 1570
10/03 LOJA BR 10,00
`
    expect(extractBanrisulCardSections(text)).toEqual([])
  })

  it('keeps last section without declaredTotal when TOTAL DE GASTOS is missing', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 9999
10/03 ALGUMA COISA BR 10,00
11/03 OUTRA BR 20,00
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(1)
    expect(sections[0].cardLast4).toBe('9999')
    expect(sections[0].declaredTotal).toBeUndefined()
    expect(sections[0].rawLines).toHaveLength(2)
    expect(sections[0].rawSectionText).not.toContain('TOTAL DE GASTOS')
  })

  it('closes previous section without total when a new card header appears', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
MARIA - NR. 1111
01/02 COMPRA A BR 10,00
JOSE - NR. 2222
02/02 COMPRA B BR 20,00
TOTAL DE GASTOS 20,00
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(2)
    expect(sections[0].cardLast4).toBe('1111')
    expect(sections[0].declaredTotal).toBeUndefined()
    expect(sections[0].rawLines).toEqual(['01/02 COMPRA A BR 10,00'])
    expect(sections[1].cardLast4).toBe('2222')
    expect(sections[1].declaredTotal).toBe(20)
  })

  it('ignores noise lines inside a section', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
10/03 LOJA BR 10,00

Pág. 2/2
11/03 OUTRA BR 5,00
TOTAL DE GASTOS 15,00
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(1)
    expect(sections[0].rawLines).toHaveLength(2)
    expect(sections[0].rawLines.every((l) => !l.includes('Pág'))).toBe(true)
  })

  it('accepts header with trailing US$ R$ after card last4 (layout boleto + histórico)', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570 US$ R$
26/02 MERCADOLIVRE BR 10,00
TOTAL DE GASTOS 10,00
ANDERSON - NR. 5112 US$ R$
10/03 AMAZON BR 20,00
TOTAL DE GASTOS 20,00
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(2)
    expect(sections[0].cardLast4).toBe('1570')
    expect(sections[0].rawLines[0]).toContain('MERCADOLIVRE')
    expect(sections[1].cardLast4).toBe('5112')
  })

  it('accepts header with NR without dot', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR 3333
10/03 X BR 1,00
TOTAL DE GASTOS 1,00
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(1)
    expect(sections[0].cardLast4).toBe('3333')
  })

  it('leaves declaredTotal undefined when TOTAL line has no amount', () => {
    const text = `
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
10/03 X BR 1,00
TOTAL DE GASTOS
`
    const sections = extractBanrisulCardSections(text)
    expect(sections).toHaveLength(1)
    expect(sections[0].declaredTotal).toBeUndefined()
  })
})
