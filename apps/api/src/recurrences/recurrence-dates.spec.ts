import { addMonthsUtc, addWeeksUtc, addYearsUtc, nextOccurrence } from './recurrence-dates'

describe('addWeeksUtc', () => {
  it('advances by one week within the same month', () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // Jan 15, 2026
    const expected = new Date(Date.UTC(2026, 0, 22, 12, 0, 0)) // Jan 22, 2026
    expect(addWeeksUtc(start, 1)).toEqual(expected)
  })

  it('crosses a month boundary', () => {
    const start = new Date(Date.UTC(2026, 0, 28, 12, 0, 0)) // Jan 28, 2026
    const expected = new Date(Date.UTC(2026, 1, 4, 12, 0, 0)) // Feb 4, 2026
    expect(addWeeksUtc(start, 1)).toEqual(expected)
  })
})

describe('addMonthsUtc', () => {
  it('advances by one month on a plain day', () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // Jan 15, 2026
    const expected = new Date(Date.UTC(2026, 1, 15, 12, 0, 0)) // Feb 15, 2026
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })

  it('clamps Jan 31 to the last day of February (non-leap year)', () => {
    const start = new Date(Date.UTC(2026, 0, 31, 12, 0, 0)) // Jan 31, 2026
    const expected = new Date(Date.UTC(2026, 1, 28, 12, 0, 0)) // Feb 28, 2026 (2026 is not a leap year)
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })

  it('clamps Jan 30 to the last day of February (non-leap year)', () => {
    const start = new Date(Date.UTC(2026, 0, 30, 12, 0, 0)) // Jan 30, 2026
    const expected = new Date(Date.UTC(2026, 1, 28, 12, 0, 0)) // Feb 28, 2026
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })

  it('lands on Feb 29 when the target year is a leap year', () => {
    const start = new Date(Date.UTC(2028, 0, 29, 12, 0, 0)) // Jan 29, 2028 (2028 is a leap year)
    const expected = new Date(Date.UTC(2028, 1, 29, 12, 0, 0)) // Feb 29, 2028
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })

  it('clamps to Feb 28 when the target year is not a leap year', () => {
    const start = new Date(Date.UTC(2026, 0, 29, 12, 0, 0)) // Jan 29, 2026 (2026 is not a leap year)
    const expected = new Date(Date.UTC(2026, 1, 28, 12, 0, 0)) // Feb 28, 2026
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })

  it('crosses a year boundary', () => {
    const start = new Date(Date.UTC(2026, 11, 15, 12, 0, 0)) // Dec 15, 2026
    const expected = new Date(Date.UTC(2027, 0, 15, 12, 0, 0)) // Jan 15, 2027
    expect(addMonthsUtc(start, 1)).toEqual(expected)
  })
})

describe('addYearsUtc', () => {
  it('advances by one year on a plain day', () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // Jan 15, 2026
    const expected = new Date(Date.UTC(2027, 0, 15, 12, 0, 0)) // Jan 15, 2027
    expect(addYearsUtc(start, 1)).toEqual(expected)
  })

  it('clamps Feb 29 of a leap year to Feb 28 when the target year has no Feb 29', () => {
    const start = new Date(Date.UTC(2028, 1, 29, 12, 0, 0)) // Feb 29, 2028 (leap year)
    const expected = new Date(Date.UTC(2029, 1, 28, 12, 0, 0)) // Feb 28, 2029 (2029 is not a leap year)
    expect(addYearsUtc(start, 1)).toEqual(expected)
  })
})

describe('nextOccurrence', () => {
  const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // Jan 15, 2026

  it('advances weekly', () => {
    const expected = new Date(Date.UTC(2026, 0, 22, 12, 0, 0)) // Jan 22, 2026
    expect(nextOccurrence(start, 'WEEKLY')).toEqual(expected)
  })

  it('advances monthly', () => {
    const expected = new Date(Date.UTC(2026, 1, 15, 12, 0, 0)) // Feb 15, 2026
    expect(nextOccurrence(start, 'MONTHLY')).toEqual(expected)
  })

  it('advances yearly', () => {
    const expected = new Date(Date.UTC(2027, 0, 15, 12, 0, 0)) // Jan 15, 2027
    expect(nextOccurrence(start, 'YEARLY')).toEqual(expected)
  })

  it('throws rather than silently defaulting on an unknown frequency', () => {
    // Cast is deliberate: the type system forbids this, and the test exists to
    // prove the runtime does too, for data that reaches us from a database
    // without a CHECK constraint (the SQLite build planned for phase 1).
    expect(() =>
      nextOccurrence(start, 'FORTNIGHTLY' as unknown as 'WEEKLY'),
    ).toThrow(/FORTNIGHTLY/)
  })
})
