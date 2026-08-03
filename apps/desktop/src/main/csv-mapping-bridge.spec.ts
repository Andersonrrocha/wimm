/**
 * Behavioral proof for `proposeCsvMapping`/`applyCsvMapping` -- the pure
 * detection/apply functions the `csv-mapping:propose`/`csv-mapping:apply`
 * IPC handlers (`index.ts`) call directly. No embedded API, no profile, no
 * database: these are plain functions over a `Buffer`, run against a
 * synthetic pt-BR bank export (`;` delimiter, `1.234,56`, `DD/MM/YYYY`) --
 * exactly the representative "a bank the app has never seen" case Stage 2's
 * plan calls out.
 *
 * Runs under plain Node (via `ts-jest`), same as every other `src/main`
 * spec in this suite.
 */
import {
  applyCsvMapping,
  proposeCsvMapping,
} from './csv-mapping-bridge'
import type { CsvMapping } from '../shared/csv-mapping-protocol'

/**
 * A synthetic statement from a bank nobody wrote a parser for: `;`-delimited
 * (Brazilian convention, since `,` is the decimal separator there),
 * `DD/MM/YYYY` dates, and a single signed-amount column using `.` as the
 * thousands separator and `,` as the decimal separator -- `1.234,56` reais.
 * Row 2 is a zero-amount reversal (`0,00`), included deliberately to prove
 * the `zero_amount` warning path.
 */
const PT_BR_FIXTURE = Buffer.from(
  ['data;descricao;valor', '03/04/2026;Compra Supermercado;1.234,56', '04/04/2026;Estorno;0,00', ''].join(
    '\r\n',
  ),
  'utf8',
)

const BASE_MAPPING: CsvMapping = {
  delimiter: ';',
  hasHeader: true,
  encoding: 'utf8',
  dateColumn: 0,
  descriptionColumn: 1,
  decimalSeparator: ',',
  dateOrder: 'DMY',
  sign: { kind: 'signed_amount', amountColumn: 2 },
}

describe('proposeCsvMapping', () => {
  it('throws when fileBytes is not a Uint8Array/ArrayBuffer', () => {
    expect(() => proposeCsvMapping('not bytes')).toThrow(/fileBytes must be a Uint8Array/)
  })

  it('proposes a mapping for the pt-BR fixture, every field carrying a confidence and a reason', () => {
    const proposal = proposeCsvMapping(new Uint8Array(PT_BR_FIXTURE))

    expect(proposal.delimiter.value).toBe(';')
    expect(proposal.hasHeader.value).toBe(true)
    expect(proposal.dateColumn.value).toBe(0)
    // Every field guess carries a confidence and a human-readable reason --
    // the mapping screen renders both, never presenting a guess as a
    // certainty.
    for (const guess of [
      proposal.delimiter,
      proposal.hasHeader,
      proposal.encoding,
      proposal.dateColumn,
      proposal.descriptionColumn,
      proposal.decimalSeparator,
      proposal.dateOrder,
      proposal.sign,
    ]) {
      expect(['high', 'medium', 'low']).toContain(guess.confidence)
      expect(typeof guess.reason).toBe('string')
      expect(guess.reason.length).toBeGreaterThan(0)
    }
    // The lone decimal separator in this fixture ("1.234,56" mixes both, so
    // it is actually unambiguous here -- see the dedicated ambiguous-value
    // test below for the genuinely ambiguous case) is never asserted 'high'
    // by fiat; `overallConfidence` is whatever the weakest field reports.
    expect(['high', 'medium', 'low']).toContain(proposal.overallConfidence)
  })

  it('never reports high confidence for a genuinely ambiguous lone decimal separator', () => {
    // "1.234" alone is legitimately either 1234 (thousands grouping) or
    // 1.234 (a decimal point) -- Stage 2's plan is explicit that detection
    // must never resolve this by guessing "high".
    const ambiguous = Buffer.from(
      ['data;descricao;valor', '03/04/2026;Compra;1.234', '04/04/2026;Compra 2;2.500'].join('\r\n'),
      'utf8',
    )
    const proposal = proposeCsvMapping(new Uint8Array(ambiguous))
    expect(proposal.decimalSeparator.confidence).not.toBe('high')
  })
})

describe('applyCsvMapping', () => {
  it('throws when fileBytes is not a Uint8Array/ArrayBuffer', () => {
    expect(() => applyCsvMapping(123, BASE_MAPPING)).toThrow(/fileBytes must be a Uint8Array/)
  })

  it('throws a plain, named Error when mapping is not an object', () => {
    expect(() => applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), null)).toThrow(
      /mapping must be an object/,
    )
  })

  it('throws a plain, named Error naming the first missing/mistyped field', () => {
    const { delimiter: _delimiter, ...rest } = BASE_MAPPING
    expect(() => applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), rest)).toThrow(
      /mapping.delimiter must be a string/,
    )
  })

  it("reaches validateMapping's deeper semantic check for a shape that passes the shallow guard", () => {
    // A string, so the shallow `typeof` guard passes -- but not one of the
    // two delimiters `validateMapping` actually allows.
    const invalid: CsvMapping = { ...BASE_MAPPING, delimiter: '|' as CsvMapping['delimiter'] }
    expect(() => applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), invalid)).toThrow(
      /unsupported delimiter/,
    )
  })

  it('parses the pt-BR fixture correctly when the decimal separator is stated correctly', () => {
    const result = applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), BASE_MAPPING)

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]?.signedAmount).toBeCloseTo(1234.56, 6)
    expect(result.rows[0]?.description).toBe('Compra Supermercado')
    expect(result.rows[0]?.occurredAt).toBe(new Date(Date.UTC(2026, 3, 3, 12, 0, 0)).toISOString())

    // Row 2's zero amount is IMPORTED, not dropped -- see the zero_amount
    // warning below.
    expect(result.rows[1]?.signedAmount).toBe(0)
    const zeroWarning = result.warnings.find((w) => w.code === 'zero_amount')
    expect(zeroWarning).toBeDefined()
    expect(zeroWarning?.message).toMatch(/imported/i)

    expect(result.columnCount).toBe(3)
  })

  it('MUTATION PROOF: stating the wrong decimal separator on the same fixture produces a visibly, ~1000x wrong amount -- never silently plausible', () => {
    const wrongMapping: CsvMapping = { ...BASE_MAPPING, decimalSeparator: '.' }
    const wrongResult = applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), wrongMapping)

    // "1.234,56" read with "." stated as the decimal separator: the "," is
    // treated as a thousands separator and stripped, leaving "1.23456" --
    // 1.23456, not 1234.56. This is the exact defect class Stage 2 exists to
    // make visible before import, not the mapper failing to work at all.
    expect(wrongResult.rows[0]?.signedAmount).toBeCloseTo(1.23456, 6)
    expect(wrongResult.rows[0]?.signedAmount).not.toBeCloseTo(1234.56, 2)

    const correctResult = applyCsvMapping(new Uint8Array(PT_BR_FIXTURE), BASE_MAPPING)
    expect(correctResult.rows[0]?.signedAmount).toBeCloseTo(1234.56, 6)
  })

  it('computes columnCount from the actual file, independent of the sign convention chosen', () => {
    const debitCreditFixture = Buffer.from(
      ['data;descricao;debito;credito', '03/04/2026;Compra;123,45;', '04/04/2026;Deposito;;500,00'].join(
        '\r\n',
      ),
      'utf8',
    )
    const mapping: CsvMapping = {
      delimiter: ';',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 0,
      descriptionColumn: 1,
      decimalSeparator: ',',
      dateOrder: 'DMY',
      sign: { kind: 'debit_credit', debitColumn: 2, creditColumn: 3 },
    }
    const result = applyCsvMapping(new Uint8Array(debitCreditFixture), mapping)
    expect(result.columnCount).toBe(4)
    expect(result.rows[0]?.signedAmount).toBeCloseTo(-123.45, 6)
    expect(result.rows[1]?.signedAmount).toBeCloseTo(500, 6)
  })
})
