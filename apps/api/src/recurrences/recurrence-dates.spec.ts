import { addMonthsUtc, addWeeksUtc, addYearsUtc, nextOccurrence } from './recurrence-dates'

describe('nextOccurrence', () => {
  const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))

  it('advances weekly', () => {
    expect(nextOccurrence(start, 'WEEKLY')).toEqual(addWeeksUtc(start, 1))
  })

  it('advances monthly', () => {
    expect(nextOccurrence(start, 'MONTHLY')).toEqual(addMonthsUtc(start, 1))
  })

  it('advances yearly', () => {
    expect(nextOccurrence(start, 'YEARLY')).toEqual(addYearsUtc(start, 1))
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
