import { mapBanrisulWarningsForPreview } from './map-banrisul-parser-warnings'
import type { BanrisulOrchestratedWarning } from './parsers/banrisul-cc/parse-statement-text'

describe('mapBanrisulWarningsForPreview', () => {
  it('marks empty_section and missing_declared_total as info', () => {
    const w: BanrisulOrchestratedWarning[] = [
      { code: 'empty_section', message: 'x', cardLast4: '1111' },
      {
        code: 'missing_declared_total',
        message: 'y',
        cardLast4: '2222',
        actualTotal: 1,
      },
    ]
    const out = mapBanrisulWarningsForPreview(w)
    expect(out[0].severity).toBe('info')
    expect(out[1].severity).toBe('info')
  })

  it('marks line_parse_failed and section_total_mismatch as warning', () => {
    const w: BanrisulOrchestratedWarning[] = [
      {
        code: 'line_parse_failed',
        message: 'bad',
        rawLine: 'x',
        cardLast4: '3333',
      },
      {
        code: 'section_total_mismatch',
        message: 'mismatch',
        cardLast4: '4444',
        expectedTotal: 10,
        actualTotal: 5,
        delta: -5,
      },
    ]
    const out = mapBanrisulWarningsForPreview(w)
    expect(out[0].severity).toBe('warning')
    expect(out[1].severity).toBe('warning')
    expect(out[1].delta).toBe(-5)
  })
})
