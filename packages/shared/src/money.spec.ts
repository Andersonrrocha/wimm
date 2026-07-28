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
