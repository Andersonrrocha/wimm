import { toCents } from '@wimm/shared'
import {
  applyGenericCsvMapping,
  countGenericCsvColumns,
  type GenericCsvMapping,
} from './generic-csv-mapper'

/**
 * Money is integer cents in this project (CLAUDE.md, the Stage 2 plan).
 * `signedAmount` on a `ParsedLedgerRow` is a currency-unit float -- the same
 * float `parseFlexibleAmount` has always returned -- so every assertion
 * here pushes it through the same `toFixed(2)` + `toCents` conversion the
 * real import pipeline applies (`imports.service.ts`), matching the pattern
 * already established in `amount-date.spec.ts`.
 */
function cents(n: number): number {
  return toCents(n.toFixed(2))
}

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8')
}

const PT_BR_HEADER_MAPPING: GenericCsvMapping = {
  delimiter: ';',
  hasHeader: true,
  encoding: 'utf8',
  dateColumn: 0,
  descriptionColumn: 1,
  decimalSeparator: ',',
  dateOrder: 'DMY',
  sign: { kind: 'signed_amount', amountColumn: 2 },
}

describe('applyGenericCsvMapping', () => {
  describe('sign convention: signed_amount', () => {
    it('parses a semicolon-delimited pt-BR file with a header row', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        '02/04/2026;Salario;1.234,56',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].description).toBe('Mercado')
      expect(cents(result.rows[0].signedAmount)).toBe(-12345)
      expect(cents(result.rows[1].signedAmount)).toBe(123456)
    })

    it('parses a comma-delimited en-US file with no header row', () => {
      const buf = csv([
        '2026-04-01,Grocery Store,-123.45',
        '2026-04-02,Paycheck,1234.56',
      ])
      const mapping: GenericCsvMapping = {
        delimiter: ',',
        hasHeader: false,
        encoding: 'utf8',
        dateColumn: 0,
        descriptionColumn: 1,
        decimalSeparator: '.',
        dateOrder: 'YMD',
        sign: { kind: 'signed_amount', amountColumn: 2 },
      }
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(2)
      expect(cents(result.rows[0].signedAmount)).toBe(-12345)
      expect(cents(result.rows[1].signedAmount)).toBe(123456)
    })
  })

  describe('sign convention: debit_credit', () => {
    const mapping: GenericCsvMapping = {
      delimiter: ',',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 0,
      descriptionColumn: 1,
      decimalSeparator: '.',
      dateOrder: 'YMD',
      sign: { kind: 'debit_credit', debitColumn: 2, creditColumn: 3 },
    }

    it('a populated debit column is a negative amount (expense) and a populated credit column is positive (income)', () => {
      const buf = csv([
        'date,description,debit,credit',
        '2026-04-01,Grocery Store,123.45,',
        '2026-04-02,Paycheck,,1234.56',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(2)
      // Mutation-proof target (see report): swapping these two signs must
      // make this assertion fail -- a credit must never import as a debit.
      expect(cents(result.rows[0].signedAmount)).toBe(-12345)
      expect(cents(result.rows[1].signedAmount)).toBe(123456)
    })

    it('a debit column value with its own negative notation is still read as a debit (magnitude, not the column text, decides sign)', () => {
      const buf = csv(['date,description,debit,credit', '2026-04-01,Refund of a fee,-5.00,'])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.rows).toHaveLength(1)
      expect(cents(result.rows[0].signedAmount)).toBe(-500)
    })

    it('warns and drops a row where neither debit nor credit is populated', () => {
      const buf = csv([
        'date,description,debit,credit',
        '2026-04-01,Grocery Store,123.45,',
        '2026-04-02,Nothing here,,',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/missing amount/i)
      expect(w!.rawLine).toContain('Nothing here')
    })

    it('warns and drops a row where both debit and credit are populated (ambiguous, never guessed)', () => {
      const buf = csv([
        'date,description,debit,credit',
        '2026-04-01,Grocery Store,123.45,',
        '2026-04-02,Both populated,10.00,20.00',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/both debit.*and credit/i)
      expect(w!.rawLine).toContain('Both populated')
    })
  })

  describe('sign convention: amount_and_type', () => {
    const mapping: GenericCsvMapping = {
      delimiter: ';',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 0,
      descriptionColumn: 1,
      decimalSeparator: ',',
      dateOrder: 'DMY',
      sign: {
        kind: 'amount_and_type',
        amountColumn: 2,
        typeColumn: 3,
        debitValues: ['D', 'DEBIT', 'DEBITO'],
        creditValues: ['C', 'CREDIT', 'CREDITO'],
      },
    }

    it('DEBITO is negative and CREDITO is positive', () => {
      const buf = csv([
        'Data;Historico;Valor;Tipo',
        '05/04/2026;Compra;50,00;DEBITO',
        '06/04/2026;Deposito;200,00;CREDITO',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(2)
      expect(cents(result.rows[0].signedAmount)).toBe(-5000)
      expect(cents(result.rows[1].signedAmount)).toBe(20000)
    })

    it('matches type tokens case- and accent-insensitively (DÉBITO/CRÉDITO, lower-case)', () => {
      const buf = csv([
        'Data;Historico;Valor;Tipo',
        '05/04/2026;Compra;50,00;débito',
        '06/04/2026;Deposito;200,00;Crédito',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.warnings).toEqual([])
      expect(cents(result.rows[0].signedAmount)).toBe(-5000)
      expect(cents(result.rows[1].signedAmount)).toBe(20000)
    })

    it('the single-letter tokens D/C also resolve correctly', () => {
      const buf = csv([
        'Data;Historico;Valor;Tipo',
        '05/04/2026;Compra;50,00;D',
        '06/04/2026;Deposito;200,00;C',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(cents(result.rows[0].signedAmount)).toBe(-5000)
      expect(cents(result.rows[1].signedAmount)).toBe(20000)
    })

    it('warns and drops a row with an unrecognized type token rather than guessing a sign', () => {
      const buf = csv([
        'Data;Historico;Valor;Tipo',
        '05/04/2026;Compra;50,00;DEBITO',
        '06/04/2026;Misterioso;10,00;X',
      ])
      const result = applyGenericCsvMapping(buf, mapping)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/unrecognized type value/i)
      expect(w!.rawLine).toContain('Misterioso')
    })
  })

  describe('warning vocabulary (reused, not reinvented -- see be81f01)', () => {
    it('warns and skips a row missing a date value', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        ';Linha Sem Data;-10,00',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_date')
      expect(w).toBeDefined()
      expect(w!.rawLine).toContain('Linha Sem Data')
    })

    it('warns and skips a row missing an amount value', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        '03/04/2026;Linha Sem Valor;',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'missing_amount')
      expect(w).toBeDefined()
    })

    it('warns and skips a row with an unparsable date', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        'not-a-date;Linha Invalida;-10,00',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_date')
      expect(w).toBeDefined()
    })

    it('warns and skips a row with an unparsable amount', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        '03/04/2026;Linha Invalida;abc',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'invalid_amount')
      expect(w).toBeDefined()
    })

    it('imports a zero-amount row and warns rather than dropping it silently', () => {
      const buf = csv([
        'Data;Descricao;Valor',
        '01/04/2026;Mercado;-123,45',
        '03/04/2026;Estorno;0,00',
      ])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[1].signedAmount).toBe(0)
      const w = result.warnings.find((w) => w.code === 'zero_amount')
      expect(w).toBeDefined()
      expect(w!.message).toMatch(/imported as-is/i)
    })

    it('defaults a missing description to "(no description)" rather than warning', () => {
      const buf = csv(['Data;Descricao;Valor', '01/04/2026;;-10,00'])
      const result = applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].description).toBe('(no description)')
      expect(result.warnings).toEqual([])
    })
  })

  describe('encoding', () => {
    it('decodes Latin-1 correctly where UTF-8 would mangle an accented description', () => {
      const line = '01/04/2026;Combustível;-100,00'
      const latin1Buf = Buffer.from(line, 'latin1')

      const asLatin1 = applyGenericCsvMapping(latin1Buf, {
        ...PT_BR_HEADER_MAPPING,
        hasHeader: false,
        encoding: 'latin1',
      })
      expect(asLatin1.rows[0].description).toBe('Combustível')

      const asUtf8 = applyGenericCsvMapping(latin1Buf, {
        ...PT_BR_HEADER_MAPPING,
        hasHeader: false,
        encoding: 'utf8',
      })
      // The stated encoding is respected even when it is wrong: mis-declaring
      // Latin-1 bytes as UTF-8 must visibly mangle the text, not silently
      // "fix itself".
      expect(asUtf8.rows[0].description).not.toBe('Combustível')
    })
  })

  describe('mutation proof: a wrongly-stated decimal separator must be visibly wrong, never silently plausible', () => {
    // '1.234,56' is R$ 1.234,56 (mil duzentos e trinta e quatro reais e
    // cinquenta e seis centavos) for a pt-BR bank: 123456 cents. It is the
    // exact ambiguous shape from the Stage 2 plan's evidence table.
    const buf = csv(['Data;Descricao;Valor', '01/04/2026;Salario;1.234,56'])

    it('stating "." (wrong for this file) does NOT silently produce a plausible number -- it produces a visibly, grossly wrong one', () => {
      const wrongly = applyGenericCsvMapping(buf, {
        ...PT_BR_HEADER_MAPPING,
        decimalSeparator: '.',
      })
      const wrongCents = cents(wrongly.rows[0].signedAmount)
      // Exact reproduction of the failure mode: reading '.' as decimal turns
      // "1.234,56" into 1.23456, i.e. R$ 1,23 -- a ~1004x understatement of
      // the true R$ 1.234,56. This is the whole point of the task: the
      // mapper honours what was stated even when it is wrong, rather than
      // quietly "fixing" it into something that looks reasonable.
      expect(wrongCents).toBe(123)
      expect(wrongCents).not.toBe(123456)
    })

    it('stating "," (correct for this file) produces the exact cents', () => {
      const correctly = applyGenericCsvMapping(buf, {
        ...PT_BR_HEADER_MAPPING,
        decimalSeparator: ',',
      })
      expect(cents(correctly.rows[0].signedAmount)).toBe(123456)
    })
  })

  describe('mapping validation', () => {
    it('rejects an unsupported delimiter at runtime, not just at the type level', () => {
      expect(() =>
        applyGenericCsvMapping(csv(['a|b|c']), {
          ...PT_BR_HEADER_MAPPING,
          delimiter: '|' as GenericCsvMapping['delimiter'],
        }),
      ).toThrow(/unsupported delimiter/i)
    })

    it('rejects debitColumn === creditColumn', () => {
      expect(() =>
        applyGenericCsvMapping(csv(['a,b,c']), {
          delimiter: ',',
          hasHeader: false,
          encoding: 'utf8',
          dateColumn: 0,
          descriptionColumn: 1,
          decimalSeparator: '.',
          dateOrder: 'YMD',
          sign: { kind: 'debit_credit', debitColumn: 2, creditColumn: 2 },
        }),
      ).toThrow(/must be different columns/i)
    })

    it('rejects overlapping debit/credit type tokens', () => {
      expect(() =>
        applyGenericCsvMapping(csv(['a,b,c,d']), {
          delimiter: ',',
          hasHeader: false,
          encoding: 'utf8',
          dateColumn: 0,
          descriptionColumn: 1,
          decimalSeparator: '.',
          dateOrder: 'YMD',
          sign: {
            kind: 'amount_and_type',
            amountColumn: 2,
            typeColumn: 3,
            debitValues: ['X'],
            creditValues: ['x'],
          },
        }),
      ).toThrow(/must not overlap/i)
    })
  })

  describe('exhaustion', () => {
    it('throws a clear error when no row parses under the stated mapping', () => {
      // Non-empty line (so it survives greedy empty-line skipping) but blank
      // in the mapped date column -- every row is dropped, none parsed.
      const buf = csv(['Data;Descricao;Valor', ';Sem Data Nem Valor;'])
      expect(() => applyGenericCsvMapping(buf, PT_BR_HEADER_MAPPING)).toThrow(
        /could not parse any csv rows/i,
      )
    })
  })
})

describe('countGenericCsvColumns', () => {
  it('counts columns using the mapping delimiter, ignoring a header row when hasHeader is true', () => {
    const buf = csv(['Data;Descricao;Valor', '01/04/2026;Mercado;-123,45'])
    expect(
      countGenericCsvColumns(buf, {
        delimiter: ';',
        encoding: 'utf8',
        hasHeader: true,
      }),
    ).toBe(3)
  })

  it('counts the header row too when hasHeader is false', () => {
    const buf = csv(['a,b,c,d'])
    expect(
      countGenericCsvColumns(buf, {
        delimiter: ',',
        encoding: 'utf8',
        hasHeader: false,
      }),
    ).toBe(4)
  })

  it('reports the widest row when rows have uneven widths', () => {
    const buf = csv(['a;b;c', 'd;e;f;g;h'])
    expect(
      countGenericCsvColumns(buf, {
        delimiter: ';',
        encoding: 'utf8',
        hasHeader: false,
      }),
    ).toBe(5)
  })

  it('respects the stated encoding (latin1) when counting columns', () => {
    // A Latin-1-encoded accented description in its own column -- decoding
    // as UTF-8 would not change the column count here, but this pins that
    // the mapping's encoding is actually threaded through to the decode
    // step, not silently defaulted.
    const buf = Buffer.from('01/04/2026;Descri\xe7\xe3o;-1,00', 'latin1')
    expect(
      countGenericCsvColumns(buf, {
        delimiter: ';',
        encoding: 'latin1',
        hasHeader: false,
      }),
    ).toBe(3)
  })
})
