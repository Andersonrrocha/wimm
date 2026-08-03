import { parseCsvBuffer } from './csv-parser'

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8')
}

describe('parseCsvBuffer', () => {
  it('produces no warnings for a fully valid CSV (control: a parser that always warns is as useless as one that never does)', () => {
    const buf = csv([
      'Data;Descrição;Valor',
      '01/04/2026;Mercado Livre;-123,45',
      '02/04/2026;Salário;1.234,56',
    ])
    const result = parseCsvBuffer(buf)
    expect(result.rows).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })

  describe('recognized-header columns', () => {
    it('warns and skips a row missing a date value', () => {
      const buf = csv([
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        ';Linha Sem Data;-10,00',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_date')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/missing date/i)
      expect(w!.rawLine).toContain('Linha Sem Data')
    })

    it('warns and skips a row missing an amount value', () => {
      const buf = csv([
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        '03/04/2026;Linha Sem Valor;',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/missing amount/i)
      expect(w!.rawLine).toContain('Linha Sem Valor')
    })

    it('warns and skips a row with an unparsable date', () => {
      const buf = csv([
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        'not-a-date;Linha Invalida;-10,00',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_date')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/could not parse date/i)
      expect(w!.rawLine).toContain('Linha Invalida')
    })

    it('warns and skips a row with an unparsable amount', () => {
      const buf = csv([
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        '03/04/2026;Linha Invalida;abc',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/could not parse amount/i)
      expect(w!.rawLine).toContain('Linha Invalida')
    })

    it('imports a zero-amount row and warns about it rather than dropping it silently', () => {
      const buf = csv([
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        '03/04/2026;Estorno;0,00',
      ])
      const result = parseCsvBuffer(buf)
      // The zero-amount row IS imported -- see the decision note in csv-parser.ts.
      expect(result.rows).toHaveLength(2)
      expect(result.rows[1].signedAmount).toBe(0)
      const w = result.warnings.find((w) => w.code === 'zero_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/imported as-is/i)
      expect(w!.rawLine).toContain('Estorno')
    })
  })

  describe('positional fallback (headers not recognized)', () => {
    it('warns and skips a row missing a date value', () => {
      const buf = csv([
        'col1,col2,col3',
        '01/04/2026,-123.45,Groceries',
        ',-10.00,Missing date row',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_date')
      expect(w).toBeDefined()
      expect(w!.rawLine).toContain('Missing date row')
    })

    it('warns and skips a row missing an amount value', () => {
      const buf = csv([
        'col1,col2,col3',
        '01/04/2026,-123.45,Groceries',
        '02/04/2026,,Missing amount row',
      ])
      const result = parseCsvBuffer(buf)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_amount')
      expect(w).toBeDefined()
      expect(w!.rawLine).toContain('Missing amount row')
    })
  })
})
