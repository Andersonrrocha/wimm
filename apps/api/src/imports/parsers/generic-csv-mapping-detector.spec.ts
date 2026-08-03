import { proposeGenericCsvMapping } from './generic-csv-mapping-detector'

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8')
}

describe('proposeGenericCsvMapping', () => {
  it('never returns a result -- it always returns a proposal object with confidence signals, not an applied mapping', () => {
    const buf = csv(['Data;Descricao;Valor', '01/04/2026;Mercado;-123,45'])
    const proposal = proposeGenericCsvMapping(buf)
    // Shape check: every field is a { value, confidence, reason } guess.
    for (const key of [
      'delimiter',
      'hasHeader',
      'encoding',
      'dateColumn',
      'descriptionColumn',
      'decimalSeparator',
      'dateOrder',
      'sign',
    ] as const) {
      expect(proposal[key]).toHaveProperty('confidence')
      expect(proposal[key]).toHaveProperty('reason')
      expect(typeof proposal[key].reason).toBe('string')
      expect(['high', 'medium', 'low']).toContain(proposal[key].confidence)
    }
    expect(['high', 'medium', 'low']).toContain(proposal.overallConfidence)
  })

  describe('an obvious, well-formed file', () => {
    const buf = csv([
      'Data;Descricao;Valor',
      '01/04/2026;Mercado Livre;-123,45',
      '02/04/2026;Salario;1.234,56',
      '03/04/2026;Farmacia;-50,00',
    ])
    const proposal = proposeGenericCsvMapping(buf)

    it('proposes ";" as the delimiter with high confidence', () => {
      expect(proposal.delimiter.value).toBe(';')
      expect(proposal.delimiter.confidence).toBe('high')
    })

    it('proposes a header row with high confidence', () => {
      expect(proposal.hasHeader.value).toBe(true)
      expect(proposal.hasHeader.confidence).toBe('high')
    })

    it('proposes utf8 encoding with high confidence', () => {
      expect(proposal.encoding.value).toBe('utf8')
      expect(proposal.encoding.confidence).toBe('high')
    })

    it('proposes column 0 as the date column', () => {
      expect(proposal.dateColumn.value).toBe(0)
      expect(proposal.dateColumn.confidence).toBe('high')
    })

    it('proposes column 1 as the description column', () => {
      expect(proposal.descriptionColumn.value).toBe(1)
    })

    it('proposes a signed_amount convention on column 2, since it sees a negative-looking value', () => {
      expect(proposal.sign.value).toEqual({ kind: 'signed_amount', amountColumn: 2 })
      expect(proposal.sign.confidence).toBe('medium')
    })

    it('proposes "," as the decimal separator with high confidence, because "1.234,56" fixes it unambiguously', () => {
      expect(proposal.decimalSeparator.value).toBe(',')
      expect(proposal.decimalSeparator.confidence).toBe('high')
    })
  })

  describe('the genuinely ambiguous case -- this is the whole point of the task', () => {
    it('never proposes "high" confidence for a lone-separator amount column', () => {
      // Every amount in this sample has only one separator type and no
      // thousands-grouping evidence -- exactly the case that cannot be
      // resolved by inspection (see the Stage 2 plan's evidence table).
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;123,45',
        '02/04/2026;Farmacia;50,00',
      ])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.decimalSeparator.confidence).not.toBe('high')
      expect(proposal.overallConfidence).not.toBe('high')
    })

    it('never proposes "high" confidence for date order when every sampled day/month value is <= 12', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/02/2026;Mercado;-10,00',
        '03/04/2026;Farmacia;-20,00',
      ])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.dateOrder.confidence).toBe('low')
    })
  })

  describe('date order can be resolved when the sample itself proves it', () => {
    it('proposes MDY with high confidence when a field > 12 can only be a day', () => {
      // '25' cannot be a month -- in the first position that only makes
      // sense if the source is month-first (MDY).
      const buf = csv(['date,description,amount', '03/25/2026,Rent,-1000.00'])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.dateOrder.value).toBe('MDY')
      expect(proposal.dateOrder.confidence).toBe('high')
    })

    it('proposes YMD with high confidence for ISO-shaped dates', () => {
      const buf = csv(['date,description,amount', '2026-04-03,Rent,-1000.00'])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.dateOrder.value).toBe('YMD')
      expect(proposal.dateOrder.confidence).toBe('high')
    })
  })

  describe('sign convention detection', () => {
    it('proposes debit_credit when two amount-shaped columns are never both populated', () => {
      const buf = csv([
        'date,description,debit,credit',
        '2026-04-01,Grocery Store,123.45,',
        '2026-04-02,Paycheck,,1234.56',
      ])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.sign.value).toEqual({
        kind: 'debit_credit',
        debitColumn: 2,
        creditColumn: 3,
      })
      expect(proposal.sign.confidence).toBe('medium')
    })

    it('proposes amount_and_type when a column contains only debit/credit-style tokens', () => {
      const buf = csv([
        'Data;Historico;Valor;Tipo',
        '05/04/2026;Compra;50,00;DEBITO',
        '06/04/2026;Deposito;200,00;CREDITO',
      ])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.sign.value).toMatchObject({
        kind: 'amount_and_type',
        amountColumn: 2,
        typeColumn: 3,
      })
      expect(proposal.sign.confidence).toBe('medium')
    })

    it('returns null with low confidence when no amount-shaped column is found', () => {
      const buf = csv(['a;b;c', 'foo;bar;baz'])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.sign.value).toBeNull()
      expect(proposal.sign.confidence).toBe('low')
    })
  })

  describe('encoding detection', () => {
    it('proposes latin1 with medium confidence for a buffer that is not valid UTF-8', () => {
      // A byte sequence that is invalid UTF-8 (a lone continuation byte).
      const invalidUtf8 = Buffer.from([0x41, 0xe9, 0x42])
      const proposal = proposeGenericCsvMapping(invalidUtf8)
      expect(proposal.encoding.value).toBe('latin1')
      expect(proposal.encoding.confidence).toBe('medium')
    })
  })

  describe('header detection', () => {
    it('proposes no header, medium confidence, when the first row already contains numbers/dates', () => {
      const buf = csv(['01/04/2026,Mercado,-123.45', '02/04/2026,Farmacia,-50.00'])
      const proposal = proposeGenericCsvMapping(buf)
      expect(proposal.hasHeader.value).toBe(false)
      expect(proposal.hasHeader.confidence).toBe('medium')
    })
  })
})
