import { parseOfxBuffer } from './ofx-parser'

function stmttrn(inner: string): string {
  return `<STMTTRN>\n${inner}\n</STMTTRN>`
}

const GOOD_BLOCK = stmttrn(
  [
    '<TRNTYPE>DEBIT',
    '<DTPOSTED>20260401120000',
    '<TRNAMT>-123.45',
    '<FITID>1',
    '<MEMO>PIX DEBITO',
  ].join('\n'),
)

function ofx(...blocks: string[]): Buffer {
  return Buffer.from(blocks.join('\n'), 'utf8')
}

describe('parseOfxBuffer', () => {
  it('produces no warnings for a fully valid OFX file (control: a parser that always warns is as useless as one that never does)', () => {
    const second = stmttrn(
      [
        '<TRNTYPE>CREDIT',
        '<DTPOSTED>20260402120000',
        '<TRNAMT>1234.56',
        '<FITID>2',
        '<MEMO>SALARIO',
      ].join('\n'),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, second))
    expect(result.rows).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })

  it('warns and skips a block missing <DTPOSTED>/<DTUSER>', () => {
    const bad = stmttrn(
      ['<TRNTYPE>DEBIT', '<TRNAMT>-10.00', '<FITID>3', '<MEMO>SEM DATA'].join(
        '\n',
      ),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, bad))
    expect(result.rows).toHaveLength(1)
    const w = result.warnings.find((w) => w.code === 'missing_date')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/missing <DTPOSTED>/i)
    expect(w!.rawBlock).toContain('SEM DATA')
  })

  it('warns and skips a block missing <TRNAMT>', () => {
    const bad = stmttrn(
      [
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20260403120000',
        '<FITID>4',
        '<MEMO>SEM VALOR',
      ].join('\n'),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, bad))
    expect(result.rows).toHaveLength(1)
    const w = result.warnings.find((w) => w.code === 'missing_amount')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/missing <TRNAMT>/i)
    expect(w!.rawBlock).toContain('SEM VALOR')
  })

  it('warns and skips a block with an unparsable <TRNAMT>', () => {
    const bad = stmttrn(
      [
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20260403120000',
        '<TRNAMT>abc',
        '<FITID>5',
        '<MEMO>VALOR INVALIDO',
      ].join('\n'),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, bad))
    expect(result.rows).toHaveLength(1)
    const w = result.warnings.find((w) => w.code === 'invalid_amount')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/could not parse amount/i)
    expect(w!.rawBlock).toContain('VALOR INVALIDO')
  })

  it('warns and skips a block with an unparsable <DTPOSTED>', () => {
    const bad = stmttrn(
      [
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>2026',
        '<TRNAMT>-10.00',
        '<FITID>6',
        '<MEMO>DATA INVALIDA',
      ].join('\n'),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, bad))
    expect(result.rows).toHaveLength(1)
    const w = result.warnings.find((w) => w.code === 'invalid_date')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/could not parse date/i)
    expect(w!.rawBlock).toContain('DATA INVALIDA')
  })

  it('imports a zero-amount transaction and warns about it rather than dropping it silently', () => {
    const zero = stmttrn(
      [
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20260403120000',
        '<TRNAMT>0.00',
        '<FITID>7',
        '<MEMO>ESTORNO',
      ].join('\n'),
    )
    const result = parseOfxBuffer(ofx(GOOD_BLOCK, zero))
    // The zero-amount transaction IS imported -- see the decision note in ofx-parser.ts.
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1].signedAmount).toBe(0)
    const w = result.warnings.find((w) => w.code === 'zero_amount')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/imported as-is/i)
    expect(w!.rawBlock).toContain('ESTORNO')
  })
})
