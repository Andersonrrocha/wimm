import { mapOfxWarningsForPreview } from './map-ofx-parser-warnings'
import type { OfxParseWarning } from './parsers/ofx-parser'

describe('mapOfxWarningsForPreview', () => {
  it('marks zero_amount as info', () => {
    const w: OfxParseWarning[] = [
      { code: 'zero_amount', message: 'x', rawBlock: '<STMTTRN>...' },
    ]
    const out = mapOfxWarningsForPreview(w)
    expect(out[0].severity).toBe('info')
  })

  it('marks missing_date, missing_amount, invalid_date and invalid_amount as warning', () => {
    const w: OfxParseWarning[] = [
      { code: 'missing_date', message: 'a', rawBlock: 'x' },
      { code: 'missing_amount', message: 'b', rawBlock: 'x' },
      { code: 'invalid_date', message: 'c', rawBlock: 'x' },
      { code: 'invalid_amount', message: 'd', rawBlock: 'x' },
    ]
    const out = mapOfxWarningsForPreview(w)
    for (const o of out) {
      expect(o.severity).toBe('warning')
    }
  })

  it('carries rawBlock through as both rawBlock and rawLine', () => {
    const out = mapOfxWarningsForPreview([
      { code: 'missing_amount', message: 'a', rawBlock: '<STMTTRN>foo</STMTTRN>' },
    ])
    expect(out[0].rawBlock).toBe('<STMTTRN>foo</STMTTRN>')
    expect(out[0].rawLine).toBe('<STMTTRN>foo</STMTTRN>')
  })
})
