import {
  computeImportFingerprint,
  computeProjectedInstallmentFingerprint,
  dateKeyUtc,
  normalizeDescription,
} from './fingerprint'

/**
 * Golden hashes. These values are load-bearing: they are stored on every
 * existing Transaction row and are how re-imports are recognized as duplicates.
 * A failure here means deduplication broke for every user, not that the test
 * is stale. Never regenerate these to make the suite green.
 */
describe('fingerprint stability', () => {
  const userId = '3f1b9c72-0000-4000-8000-000000000001'
  const sourceId = '3f1b9c72-0000-4000-8000-000000000002'
  const occurredAt = new Date('2026-03-15T13:45:00.000Z')

  it('computes a stable import fingerprint', () => {
    expect(
      computeImportFingerprint(
        userId,
        sourceId,
        occurredAt,
        'EXPENSE',
        150.45,
        '  Mercado   Central  ',
      ),
    ).toBe('7fc7bcc799d1076b1a95c57ecb72911277c888111437a5fbac522f7723f7121f')
  })

  it('ignores time of day', () => {
    const sameDay = new Date('2026-03-15T23:59:59.999Z')
    expect(
      computeImportFingerprint(userId, sourceId, sameDay, 'EXPENSE', 150.45, 'Mercado Central'),
    ).toBe(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', 150.45, 'Mercado Central'),
    )
  })

  it('treats sign as irrelevant to the amount component', () => {
    expect(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', -150.45, 'Mercado Central'),
    ).toBe(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', 150.45, 'Mercado Central'),
    )
  })

  it('computes a stable projected installment fingerprint', () => {
    expect(
      computeProjectedInstallmentFingerprint(
        userId,
        '3f1b9c72-0000-4000-8000-000000000003',
        2,
        occurredAt,
        'EXPENSE',
        75.2,
      ),
    ).toBe('5e30ee9f65ec4b2e4a815f77413de7a648696a78b5f20b0773318d5cb557b77f')
  })

  it('normalizes descriptions by collapsing whitespace and lowercasing', () => {
    expect(normalizeDescription('  Mercado   Central  ')).toBe('mercado central')
  })

  it('keys dates by UTC calendar day', () => {
    expect(dateKeyUtc(occurredAt)).toBe('2026-03-15')
  })
})
