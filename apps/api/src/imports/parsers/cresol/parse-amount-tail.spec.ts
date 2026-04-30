import { parseCresolAmountTail } from './parse-amount-tail'

describe('parseCresolAmountTail', () => {
  it('parses PIX debit pattern', () => {
    const r = parseCresolAmountTail(
      'PIX DEBITO PARA: ALGUEM - R$ 360,00',
    )
    expect(r).toEqual({
      descriptionPart: 'PIX DEBITO PARA: ALGUEM',
      sign: -1,
      amount: 360,
    })
  })

  it('parses PIX credit with plus', () => {
    const r = parseCresolAmountTail('PIX CREDITO DE: ACME + R$ 63,48')
    expect(r).toEqual({
      descriptionPart: 'PIX CREDITO DE: ACME',
      sign: 1,
      amount: 63.48,
    })
  })

  it('parses thousands separator', () => {
    const r = parseCresolAmountTail(
      'DEBITO AUTOMATICO FATURA MASTERCARD - R$ 1.548,66',
    )
    expect(r).toEqual({
      descriptionPart: 'DEBITO AUTOMATICO FATURA MASTERCARD',
      sign: -1,
      amount: 1548.66,
    })
  })

  it('parses amount-only line for multiline descriptions', () => {
    expect(parseCresolAmountTail('+ R$ 63,48')).toEqual({
      descriptionPart: '',
      sign: 1,
      amount: 63.48,
    })
  })

  it('returns null when no amount tail', () => {
    expect(parseCresolAmountTail('PIX sem valor')).toBeNull()
  })
})
