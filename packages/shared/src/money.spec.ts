import { fromCents, toCents } from './money'

describe('toCents', () => {
  it('parses decimal strings exactly', () => {
    expect(toCents('0.00')).toBe(0)
    expect(toCents('1.00')).toBe(100)
    expect(toCents('150.45')).toBe(15045)
    expect(toCents('0.01')).toBe(1)
    expect(toCents('-42.50')).toBe(-4250)
  })

  it('accepts fewer than two decimal places', () => {
    expect(toCents('7')).toBe(700)
    expect(toCents('7.5')).toBe(750)
  })

  it('is immune to binary float error on string input', () => {
    // 0.1 + 0.2 === 0.30000000000000004; the string path never multiplies.
    expect(toCents('0.30')).toBe(30)
    expect(toCents('1.005')).toBe(101)
    expect(toCents('2.675')).toBe(268)
  })

  it('rounds number input the way the services already do', () => {
    expect(toCents(150.45)).toBe(15045)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(-42.5)).toBe(-4250)
  })

  it('rejects unusable input', () => {
    expect(() => toCents(Number.NaN)).toThrow(RangeError)
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toCents('abc')).toThrow(RangeError)
    expect(() => toCents('')).toThrow(RangeError)
  })

  it('never returns -0 for a zero amount, however signed', () => {
    // `-0 === 0` is true and `-0` serializes as `0` in JSON, but
    // `Object.is(-0, 0)` is false — a trap for strict-identity comparisons.
    expect(Object.is(toCents('-0.00'), 0)).toBe(true)
    expect(Object.is(toCents('-0'), 0)).toBe(true)
    expect(Object.is(toCents(-0), 0)).toBe(true)
  })

  it('rejects a leading decimal point with no whole-number digit', () => {
    // Money always crosses the wire with a leading digit (services emit
    // '0.50', never '.50'); a bare '.5' is refused rather than silently
    // treated as zero-point-five.
    expect(() => toCents('.5')).toThrow(RangeError)
  })

  it('rejects a trailing decimal point with no fractional digit', () => {
    expect(() => toCents('5.')).toThrow(RangeError)
  })

  it('rejects a leading plus sign', () => {
    // No caller ever emits '+5.00'; treat it as malformed rather than
    // widening the parser to accept a form nothing produces.
    expect(() => toCents('+5.00')).toThrow(RangeError)
  })

  it('accepts surrounding whitespace but not whitespace inside the number', () => {
    expect(toCents(' 5.00')).toBe(500)
    expect(toCents('5.00 ')).toBe(500)
    expect(toCents('\t-42.50\n')).toBe(-4250)
    expect(() => toCents('5 .00')).toThrow(RangeError)
    expect(() => toCents('- 5.00')).toThrow(RangeError)
  })

  it('rejects magnitudes at or beyond 1e21 rather than misparsing exponential notation', () => {
    // Number.prototype.toFixed(2) switches to exponential text ("1e+21") at
    // this threshold instead of throwing, so the safety net is the decimal
    // pattern failing to match that text — verified here so a future change
    // to the parsing strategy doesn't silently drop this protection.
    // (Not reachable today from any HTTP-facing call site: every DTO that
    // feeds toCents bounds `amount` with `@Max(21474836.47)`, far below this
    // threshold — see money-dto @Max comments in apps/api.)
    expect(() => toCents(1e21)).toThrow(RangeError)
    expect(() => toCents(-1e21)).toThrow(RangeError)
  })
})

describe('fromCents', () => {
  it('always renders two decimal places', () => {
    expect(fromCents(0)).toBe('0.00')
    expect(fromCents(1)).toBe('0.01')
    expect(fromCents(100)).toBe('1.00')
    expect(fromCents(15045)).toBe('150.45')
    expect(fromCents(-4250)).toBe('-42.50')
  })

  it('round-trips with toCents', () => {
    for (const cents of [0, 1, 99, 100, 15045, -1, -4250, 999999999]) {
      expect(toCents(fromCents(cents))).toBe(cents)
    }
  })

  it('rejects non-integer input', () => {
    expect(() => fromCents(1.5)).toThrow(RangeError)
  })
})
