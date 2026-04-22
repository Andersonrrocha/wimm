import { parseFlexibleDate } from './amount-date'

describe('parseFlexibleDate', () => {
  it('parses DD/MM/YYYY as Brazil (day first), not US month first', () => {
    const d = parseFlexibleDate('12/03/2025')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(2)
    expect(d.getUTCDate()).toBe(12)
  })

  it('ignores trailing time on DD/MM/YYYY', () => {
    const d = parseFlexibleDate('26/08/2025 14:04')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(7)
    expect(d.getUTCDate()).toBe(26)
  })

  it('parses compact 8 digits as DDMMYYYY when first 4 are not a plausible year', () => {
    const d = parseFlexibleDate('26082025')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(7)
    expect(d.getUTCDate()).toBe(26)
  })

  it('parses compact 8 digits as YYYYMMDD when year-first', () => {
    const d = parseFlexibleDate('20250315')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(2)
    expect(d.getUTCDate()).toBe(15)
  })

  it('parses ISO date', () => {
    const d = parseFlexibleDate('2025-03-15')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(2)
    expect(d.getUTCDate()).toBe(15)
  })
})
