import { sanitizePersistedInstallment } from './import-installment.util'

describe('sanitizePersistedInstallment', () => {
  it('accepts 01/01, 01/12, and 12/12', () => {
    expect(sanitizePersistedInstallment(1, 1)).toEqual({
      installmentCurrent: 1,
      installmentTotal: 1,
    })
    expect(sanitizePersistedInstallment(1, 12)).toEqual({
      installmentCurrent: 1,
      installmentTotal: 12,
    })
    expect(sanitizePersistedInstallment(12, 12)).toEqual({
      installmentCurrent: 12,
      installmentTotal: 12,
    })
  })

  it('rejects 13/05 (current > total)', () => {
    expect(sanitizePersistedInstallment(13, 5)).toBeNull()
  })

  it('rejects zero or negative', () => {
    expect(sanitizePersistedInstallment(0, 5)).toBeNull()
    expect(sanitizePersistedInstallment(1, 0)).toBeNull()
    expect(sanitizePersistedInstallment(-1, 5)).toBeNull()
  })

  it('rejects partial or non-integer input', () => {
    expect(sanitizePersistedInstallment(1, undefined)).toBeNull()
    expect(sanitizePersistedInstallment(undefined, 5)).toBeNull()
    expect(sanitizePersistedInstallment(1.5, 5)).toBeNull()
  })
})
