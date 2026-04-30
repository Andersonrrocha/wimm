import { BANRISUL_PDF_MIN_TEXT_CHARS } from './extract-pdf-text'
import { canParseBanrisulCreditCardPdf } from './banrisul-layout-guard'

function validBanrisulSkeleton(extra = ''): string {
  return `
FATURA CARTÃO BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${extra}
`.trim()
}

describe('canParseBanrisulCreditCardPdf', () => {
  it('accepts a matching Banrisul statement layout', () => {
    const text =
      validBanrisulSkeleton('note '.repeat(30))
    expect(canParseBanrisulCreditCardPdf(text)).toEqual({ ok: true })
  })

  it('accepts Vencimento instead of Data Documento', () => {
    const text = `
FATURA BANRISUL
Vencimento: 01/01/2026
HISTÓRICO DE TRANSAÇÕES
X - NR. 1000
10/01 A BR 1,00
TOTAL DE GASTOS 1,00
${'x'.repeat(120)}
`.trim()
    expect(canParseBanrisulCreditCardPdf(text)).toEqual({ ok: true })
  })

  it('rejects text shorter than minimum extraction length', () => {
    const text = 'short'
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/too little selectable text/i)
  })

  it('rejects when trimmed length is just below minimum', () => {
    const text = 'y'.repeat(BANRISUL_PDF_MIN_TEXT_CHARS - 1)
    expect(text.length).toBe(BANRISUL_PDF_MIN_TEXT_CHARS - 1)
    expect(canParseBanrisulCreditCardPdf(text).ok).toBe(false)
  })

  it('rejects unrelated long text', () => {
    const text = `
This is a generic PDF with enough text to pass minimum extraction length.
No credit card statement markers here. Just padding content repeated.
${'line '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/HISTÓRICO/i)
  })

  it('rejects when HISTÓRICO is missing', () => {
    const text = `
BANRISUL FATURA
Data Documento 06/04/2026
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'p '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/HISTÓRICO/i)
  })

  it('rejects when statement date lines are missing', () => {
    const text = `
FATURA BANRISUL
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'p '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/Data Documento|Vencimento/i)
  })

  it('rejects when no NR. card headers', () => {
    const text = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'p '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/NR\./i)
  })

  it('rejects when TOTAL DE GASTOS is missing', () => {
    const text = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
${'p '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/TOTAL DE GASTOS/i)
  })

  it('rejects when Banrisul summary markers are missing', () => {
    const text = `
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'p '.repeat(40)}
`.trim()
    const r = canParseBanrisulCreditCardPdf(text)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected fail')
    expect(r.message).toMatch(/Banrisul invoice wording/i)
  })
})
