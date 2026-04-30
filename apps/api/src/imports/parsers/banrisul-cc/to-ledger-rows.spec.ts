import { banrisulStatementToLedgerRows } from './to-ledger-rows'
import type { BanrisulStatementParseResult } from './parse-statement-text'

describe('banrisulStatementToLedgerRows', () => {
  it('maps transactions to negative signed amounts and merchant description', () => {
    const d = new Date('2026-02-26T12:00:00.000Z')
    const result: BanrisulStatementParseResult = {
      statementDate: new Date('2026-04-06T12:00:00.000Z'),
      transactions: [
        {
          cardLast4: '1570',
          transactionDate: d,
          merchantRaw: 'MERCADOLIVRE 5PRODU',
          amount: 108.92,
          installmentCurrent: 1,
          installmentTotal: 5,
          rawLine: 'x',
          confidence: 'high',
        },
      ],
      warnings: [],
    }
    const rows = banrisulStatementToLedgerRows(result)
    expect(rows).toHaveLength(1)
    expect(rows[0].occurredAt).toEqual(d)
    expect(rows[0].signedAmount).toBe(-108.92)
    expect(rows[0].description).toBe('MERCADOLIVRE 5PRODU')
    expect(rows[0].installmentCurrent).toBe(1)
    expect(rows[0].installmentTotal).toBe(5)
  })
})
