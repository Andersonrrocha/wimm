import { mapCsvWarningsForPreview } from './map-csv-parser-warnings'
import type { CsvParseWarning } from './parsers/csv-parser'

describe('mapCsvWarningsForPreview', () => {
  it('marks zero_amount as info', () => {
    const w: CsvParseWarning[] = [
      { code: 'zero_amount', message: 'x', rawLine: 'a=1' },
    ]
    const out = mapCsvWarningsForPreview(w)
    expect(out[0].severity).toBe('info')
  })

  it('marks missing_date, missing_amount, invalid_date and invalid_amount as warning', () => {
    const w: CsvParseWarning[] = [
      { code: 'missing_date', message: 'a', rawLine: 'x' },
      { code: 'missing_amount', message: 'b', rawLine: 'x' },
      { code: 'invalid_date', message: 'c', rawLine: 'x' },
      { code: 'invalid_amount', message: 'd', rawLine: 'x' },
    ]
    const out = mapCsvWarningsForPreview(w)
    for (const o of out) {
      expect(o.severity).toBe('warning')
    }
  })

  it('carries rawLine through', () => {
    const out = mapCsvWarningsForPreview([
      { code: 'missing_date', message: 'a', rawLine: 'Data=; Valor=1' },
    ])
    expect(out[0].rawLine).toBe('Data=; Valor=1')
  })
})
