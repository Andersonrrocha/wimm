import { ImportBatchFormat } from '@wimm/shared'
import {
  IMPORT_PARSERS,
  createGenericCsvMapperParser,
  findParsersForFileName,
  getImportParser,
} from './import-parser-registry'
import type { GenericCsvMapping } from './parsers/generic-csv-mapper'

const BANRISUL_FIXTURE = `
FATURA CARTÃO BANRISUL
Data Documento 06/04/2026
Vencimento 06/04/2026

HISTÓRICO DE TRANSAÇÕES

ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'note '.repeat(30)}
`.trim()

const CRESOL_FIXTURE = `
CRESOL
Extrato de Conta Corrente
Cooperativa Teste
Agência 0001

01/04/2025 PIX DEBITO PARA: FULANO - R$ 25,00
${'note '.repeat(30)}
`.trim()

describe('import parser registry', () => {
  it('registers exactly one parser per supported import format', () => {
    expect(IMPORT_PARSERS.map((p) => p.format)).toEqual([
      ImportBatchFormat.CSV,
      ImportBatchFormat.OFX,
      ImportBatchFormat.PDF_BANRISUL_CC,
      ImportBatchFormat.PDF_CRESOL_STATEMENT,
    ])
  })

  describe('findParsersForFileName', () => {
    it('matches a .csv file to the CSV parser only', () => {
      expect(findParsersForFileName('statement.csv').map((p) => p.format)).toEqual([
        ImportBatchFormat.CSV,
      ])
    })

    it('matches .ofx and .qfx files to the OFX parser only', () => {
      expect(findParsersForFileName('a.ofx').map((p) => p.format)).toEqual([
        ImportBatchFormat.OFX,
      ])
      expect(findParsersForFileName('a.qfx').map((p) => p.format)).toEqual([
        ImportBatchFormat.OFX,
      ])
    })

    it('is case-insensitive on the extension', () => {
      expect(findParsersForFileName('A.CSV').map((p) => p.format)).toEqual([
        ImportBatchFormat.CSV,
      ])
    })

    it('offers both PDF layouts as candidates for a .pdf file, Banrisul before Cresol', () => {
      expect(findParsersForFileName('statement.pdf').map((p) => p.format)).toEqual([
        ImportBatchFormat.PDF_BANRISUL_CC,
        ImportBatchFormat.PDF_CRESOL_STATEMENT,
      ])
    })

    it('returns no candidates for an unsupported extension', () => {
      expect(findParsersForFileName('statement.xls')).toEqual([])
    })
  })

  describe('getImportParser', () => {
    it('resolves every registered format back to its parser', () => {
      for (const parser of IMPORT_PARSERS) {
        expect(getImportParser(parser.format)).toBe(parser)
      }
    })

    it('rejects a format nothing implements', () => {
      expect(() =>
        getImportParser('NOT_A_FORMAT' as ImportBatchFormat),
      ).toThrow(/Unsupported import format/i)
    })
  })

  describe('CSV parser', () => {
    const parser = getImportParser(ImportBatchFormat.CSV)

    it('has no needsExtractedText requirement and always confirms a match', () => {
      expect(parser.needsExtractedText).toBeUndefined()
      expect(parser.canHandle({ buffer: Buffer.alloc(0) })).toEqual({ ok: true })
    })

    it('parses a buffer into rows with an empty warnings array', () => {
      const buf = Buffer.from(
        'date,amount,description\n2024-01-10,10.00,Coffee\n',
      )
      const result = parser.parse({ buffer: buf })
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].description).toBe('Coffee')
      expect(result.statementBillingPreview).toBeUndefined()
    })
  })

  describe('OFX parser', () => {
    const parser = getImportParser(ImportBatchFormat.OFX)

    it('parses a buffer into rows with an empty warnings array', () => {
      const buf = Buffer.from(
        '<STMTTRN><DTPOSTED>20240110<TRNAMT>-10.00<MEMO>Coffee<NAME>Cafe</STMTTRN>',
      )
      const result = parser.parse({ buffer: buf })
      expect(result.warnings).toEqual([])
      expect(result.rows).toHaveLength(1)
      expect(result.statementBillingPreview).toBeUndefined()
    })
  })

  describe('Banrisul credit card PDF parser', () => {
    const parser = getImportParser(ImportBatchFormat.PDF_BANRISUL_CC)

    it('needs pre-extracted text and sniffs its own layout', () => {
      expect(parser.needsExtractedText).toBe(true)
      expect(
        parser.canHandle({ buffer: Buffer.alloc(0), extractedText: BANRISUL_FIXTURE }),
      ).toEqual({ ok: true })
    })

    it('does not match Cresol statement text', () => {
      const match = parser.canHandle({
        buffer: Buffer.alloc(0),
        extractedText: CRESOL_FIXTURE,
      })
      expect(match.ok).toBe(false)
    })

    it('parses matching text into rows, empty warnings, and a statement billing preview', () => {
      const result = parser.parse({
        buffer: Buffer.alloc(0),
        extractedText: BANRISUL_FIXTURE,
      })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].description).toBe('LOJA')
      expect(result.warnings).toEqual([])
      expect(result.statementBillingPreview).toEqual({
        paymentDueDate: '2026-04-06',
        statementClosingDate: '2026-04-06',
      })
    })

    it('rejects text that fails its own layout guard, even when parse is called directly', () => {
      const longButNotBanrisul = `not a statement ${'padding '.repeat(20)}`
      expect(() =>
        parser.parse({ buffer: Buffer.alloc(0), extractedText: longButNotBanrisul }),
      ).toThrow(/HIST[ÓO]RICO DE TRANSA[ÇC][ÕO]ES/i)
    })

    it('requires pre-extracted text -- refuses to read the PDF itself', () => {
      expect(() => parser.parse({ buffer: Buffer.alloc(0) })).toThrow(
        /pre-extracted PDF text/i,
      )
    })
  })

  describe('Cresol statement PDF parser', () => {
    const parser = getImportParser(ImportBatchFormat.PDF_CRESOL_STATEMENT)

    it('needs pre-extracted text and sniffs its own layout', () => {
      expect(parser.needsExtractedText).toBe(true)
      expect(
        parser.canHandle({ buffer: Buffer.alloc(0), extractedText: CRESOL_FIXTURE }),
      ).toEqual({ ok: true })
    })

    it('does not match Banrisul statement text', () => {
      const match = parser.canHandle({
        buffer: Buffer.alloc(0),
        extractedText: BANRISUL_FIXTURE,
      })
      expect(match.ok).toBe(false)
    })

    it('parses matching text into rows with an empty warnings array', () => {
      const result = parser.parse({
        buffer: Buffer.alloc(0),
        extractedText: CRESOL_FIXTURE,
      })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].signedAmount).toBe(-25)
      expect(result.warnings).toEqual([])
      expect(result.statementBillingPreview).toBeUndefined()
    })

    it('requires pre-extracted text -- refuses to read the PDF itself', () => {
      expect(() => parser.parse({ buffer: Buffer.alloc(0) })).toThrow(
        /pre-extracted PDF text/i,
      )
    })
  })

  describe('createGenericCsvMapperParser', () => {
    const mapping: GenericCsvMapping = {
      delimiter: ';',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 0,
      descriptionColumn: 1,
      decimalSeparator: ',',
      dateOrder: 'DMY',
      sign: { kind: 'signed_amount', amountColumn: 2 },
    }

    it('is not part of the auto-detected registry -- a generic mapping cannot be decided from a file name or content sniff alone', () => {
      expect(IMPORT_PARSERS).toHaveLength(4)
      expect(IMPORT_PARSERS.map((p) => p.format)).toEqual([
        ImportBatchFormat.CSV,
        ImportBatchFormat.OFX,
        ImportBatchFormat.PDF_BANRISUL_CC,
        ImportBatchFormat.PDF_CRESOL_STATEMENT,
      ])
    })

    it('conforms to the same ImportFormatParser contract as every registered parser', () => {
      const parser = createGenericCsvMapperParser(mapping)
      expect(parser.format).toBe(ImportBatchFormat.CSV)
      expect(parser.extensions).toEqual(['csv'])
      expect(parser.needsExtractedText).toBeUndefined()
      expect(parser.canHandle({ buffer: Buffer.alloc(0) })).toEqual({ ok: true })
    })

    it('parses a buffer through the stated mapping', () => {
      const parser = createGenericCsvMapperParser(mapping)
      const buf = Buffer.from(
        'Data;Descricao;Valor\n01/04/2026;Mercado;-123,45\n',
        'utf8',
      )
      const result = parser.parse({ buffer: buf })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].description).toBe('Mercado')
      expect(result.warnings).toEqual([])
      expect(result.statementBillingPreview).toBeUndefined()
    })

    it('maps warnings through the same preview shape as the header-driven CSV parser, including info-level zero_amount', () => {
      const parser = createGenericCsvMapperParser(mapping)
      const buf = Buffer.from(
        'Data;Descricao;Valor\n01/04/2026;Estorno;0,00\n',
        'utf8',
      )
      const result = parser.parse({ buffer: buf })
      expect(result.rows).toHaveLength(1)
      const w = result.warnings.find((w) => w.code === 'zero_amount')
      expect(w).toBeDefined()
      expect(w!.severity).toBe('info')
    })

    it('a different mapping instance behaves independently (no shared state between calls)', () => {
      const commaParser = createGenericCsvMapperParser({
        ...mapping,
        delimiter: ',',
        decimalSeparator: '.',
      })
      const buf = Buffer.from('date,description,amount\n2026-04-01,Rent,-1000.00\n', 'utf8')
      const result = commaParser.parse({ buffer: buf })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].signedAmount).toBe(-1000)
    })
  })
})
