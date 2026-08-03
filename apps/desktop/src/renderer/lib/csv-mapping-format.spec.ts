import {
  buildColumnIndexOptions,
  classifyCsvMappingWarning,
  confidenceBadgeVariant,
  formatSignedMoney,
  splitRawPreviewLines,
} from './csv-mapping-format'

describe('confidenceBadgeVariant', () => {
  it('maps high/medium/low to positive/info/warning -- never neutral', () => {
    expect(confidenceBadgeVariant('high')).toBe('positive')
    expect(confidenceBadgeVariant('medium')).toBe('info')
    expect(confidenceBadgeVariant('low')).toBe('warning')
  })
})

describe('formatSignedMoney', () => {
  it('formats a positive amount with an explicit "+" and grouping', () => {
    expect(formatSignedMoney(1234.56)).toBe('+ 1,234.56')
  })

  it('formats a negative amount with the minus sign and grouping', () => {
    expect(formatSignedMoney(-1234.56)).toBe('− 1,234.56')
  })

  it('formats zero with no sign at all', () => {
    expect(formatSignedMoney(0)).toBe('0.00')
  })

  it('makes a wrong-decimal-separator mistake visually obvious next to the correct value', () => {
    // The exact defect Stage 2's plan measured: "1.234,56" misread with the
    // wrong stated separator becomes 1.23456 -- formatted, that is instantly
    // distinguishable from the correct 1,234.56.
    const wrong = formatSignedMoney(1.23456)
    const correct = formatSignedMoney(1234.56)
    expect(wrong).not.toBe(correct)
    expect(wrong).toBe('+ 1.23')
    expect(correct).toBe('+ 1,234.56')
  })
})

describe('classifyCsvMappingWarning', () => {
  it('classifies zero_amount as imported, never as dropped', () => {
    expect(classifyCsvMappingWarning('zero_amount')).toBe('imported')
  })

  it.each(['missing_date', 'missing_amount', 'invalid_date', 'invalid_amount'])(
    'classifies %s as dropped',
    (code) => {
      expect(classifyCsvMappingWarning(code)).toBe('dropped')
    },
  )
})

describe('buildColumnIndexOptions', () => {
  it('builds one option per column, 0-based', () => {
    expect(buildColumnIndexOptions(3)).toEqual([
      { value: '0', label: 'Column 0' },
      { value: '1', label: 'Column 1' },
      { value: '2', label: 'Column 2' },
    ])
  })

  it('returns an empty array for zero or negative counts', () => {
    expect(buildColumnIndexOptions(0)).toEqual([])
    expect(buildColumnIndexOptions(-1)).toEqual([])
  })
})

describe('splitRawPreviewLines', () => {
  it('splits decoded text into rows of columns by the stated delimiter', () => {
    const text = 'data;descricao;valor\r\n03/04/2026;Compra;1.234,56\r\n'
    expect(splitRawPreviewLines(text, ';')).toEqual([
      ['data', 'descricao', 'valor'],
      ['03/04/2026', 'Compra', '1.234,56'],
    ])
  })

  it('skips blank lines and caps at maxLines', () => {
    const text = ['a;b', '', 'c;d', 'e;f', 'g;h'].join('\n')
    expect(splitRawPreviewLines(text, ';', 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})
