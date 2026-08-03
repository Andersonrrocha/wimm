import { Test } from '@nestjs/testing'
import {
  CategoryType,
  ImportBatchFormat,
  SourceType,
  TransactionKind,
  toCents,
} from '@wimm/shared'
import { ImportsService } from './imports.service'
import { PrismaService } from '../prisma/prisma.service'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { CategorizationRulesService } from '../categorization-rules/categorization-rules.service'
import { AiKeyResolverService } from '../ai/ai-key-resolver.service'
import { AnthropicCategorizerService } from '../ai/anthropic-categorizer.service'
import { CsvSourceMappingService } from './csv-source-mapping.service'
import type { GenericCsvMapping } from './parsers/generic-csv-mapper'
import { buildPdfBufferFromPlainText } from './parsers/banrisul-cc/build-pdf-fixture'
import { extractTextFromPdfBuffer } from './parsers/banrisul-cc/extract-pdf-text'
import * as CresolExtracted from './parsers/cresol/parse-cresol-statement-extracted-text'
import { parseCresolStatementPdf } from './parsers/cresol/parse-cresol-statement-pdf'

describe('ImportsService', () => {
  let service: ImportsService
  const prismaMock = {
    source: { findFirst: jest.fn() },
    transaction: { findMany: jest.fn() },
    $transaction: jest.fn(),
  }

  const categorizationRulesMock = {
    loadActiveRulesWithCategories: jest.fn().mockResolvedValue([]),
    loadSystemResolutionContext: jest.fn().mockResolvedValue({}),
    resolveCategoryIdWithSystem: jest.fn().mockReturnValue(null),
  }

  // No saved mapping by default -- every pre-existing CSV/OFX/PDF test below
  // relies on this to keep exercising the original header-name-heuristic /
  // registry path untouched by Task 4. Individual tests in the "saved CSV
  // mapping" describe block override this per-call.
  const csvSourceMappingsMock = {
    findForSource: jest.fn().mockResolvedValue(null),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    categorizationRulesMock.loadActiveRulesWithCategories.mockResolvedValue([])
    categorizationRulesMock.loadSystemResolutionContext.mockResolvedValue({})
    categorizationRulesMock.resolveCategoryIdWithSystem.mockReturnValue(null)
    csvSourceMappingsMock.findForSource.mockResolvedValue(null)
    prismaMock.source.findFirst.mockResolvedValue({
      id: 'src-1',
      type: SourceType.CREDIT_CARD,
    })
    prismaMock.transaction.findMany.mockResolvedValue([])

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: DefaultCategoriesService,
          useValue: { ensureForUser: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CategorizationRulesService,
          useValue: categorizationRulesMock,
        },
        {
          // AI is opt-in (default OFF). Resolver returns null so the AI
          // categorizer is never called and these tests stay deterministic.
          provide: AiKeyResolverService,
          useValue: { resolveForUser: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AnthropicCategorizerService,
          useValue: { categorizeBatch: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: CsvSourceMappingService,
          useValue: csvSourceMappingsMock,
        },
      ],
    }).compile()

    service = moduleRef.get(ImportsService)
  })

  it('preview invokes Banrisul parser for matching PDF and maps rows', async () => {
    const body = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'banrisul.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.format).toBe(ImportBatchFormat.PDF_BANRISUL_CC)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].kind).toBe('EXPENSE')
    expect(r.rows[0].amount).toBe('10.00')
    expect(r.rows[0].description).toBe('LOJA')
    expect(r.parserWarnings).toEqual([])
  })

  it('preview includes installment fields on Banrisul rows when parsed', async () => {
    const body = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 MERCADOLIVRE 01/05 BR 108,92
TOTAL DE GASTOS 108,92
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'banrisul.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].installmentCurrent).toBe(1)
    expect(r.rows[0].installmentTotal).toBe(5)
    expect(r.rows[0].occurredAt).toMatch(/^2026-02-26/)
  })

  it('preview includes line_parse_failed warnings and still returns parsed rows', async () => {
    const body = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
not a valid transaction line
26/02 LOJA BR 10,00
TOTAL DE GASTOS 10,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'banrisul.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.format).toBe(ImportBatchFormat.PDF_BANRISUL_CC)
    expect(r.rows).toHaveLength(1)
    expect(r.parserWarnings).toBeDefined()
    const lineWarn = r.parserWarnings!.find((w) => w.code === 'line_parse_failed')
    expect(lineWarn).toBeDefined()
    expect(lineWarn!.severity).toBe('warning')
  })

  it('preview includes section_total_mismatch when declared total does not match sum', async () => {
    const body = `
FATURA BANRISUL
Data Documento 06/04/2026
HISTÓRICO DE TRANSAÇÕES
ANDERSON - NR. 1570
26/02 LOJA A BR 10,00
26/02 LOJA B BR 5,00
TOTAL DE GASTOS 99,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'banrisul.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.rows).toHaveLength(2)
    const mismatch = r.parserWarnings!.find(
      (w) => w.code === 'section_total_mismatch',
    )
    expect(mismatch).toBeDefined()
    expect(mismatch!.severity).toBe('warning')
    expect(mismatch!.expectedTotal).toBe(99)
    expect(mismatch!.actualTotal).toBe(15)
  })

  it('preview rejects PDF that is not a Banrisul statement layout', async () => {
    const body = `
Generic content without Banrisul markers.
${'line '.repeat(50)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'other.pdf',
      buffer: buf,
    } as Express.Multer.File

    await expect(service.preview('user-1', 'src-1', file)).rejects.toThrow(
      /not a supported bank statement|could not be read as usable text/i,
    )
  })

  it('preview parses Cresol PDF into rows', async () => {
    const body = `
CRESOL
Extrato de Conta Corrente
Cooperativa Teste
Agência 0001

01/04/2025 PIX DEBITO PARA: FULANO - R$ 25,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const { text: extracted } = await extractTextFromPdfBuffer(buf)
    expect(CresolExtracted.parseCresolStatementFromExtractedText(extracted).transactions).toHaveLength(1)

    const file = {
      originalname: 'cresol.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.format).toBe(ImportBatchFormat.PDF_CRESOL_STATEMENT)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].kind).toBe('EXPENSE')
    expect(r.rows[0].amount).toBe('25.00')
    expect(r.parserWarnings).toEqual([])
  })

  it('preview invokes block-based Cresol text parser with extracted PDF text', async () => {
    const spy = jest.spyOn(CresolExtracted, 'parseCresolStatementFromExtractedText')
    const body = `
CRESOL
Extrato de Conta Corrente
Agência 0001

02/04/2025 PIX - R$ 3,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const { text } = await extractTextFromPdfBuffer(buf)

    const file = {
      originalname: 'c2.pdf',
      buffer: buf,
    } as Express.Multer.File

    await service.preview('user-1', 'src-1', file)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(text)
    spy.mockRestore()
  })

  describe('CSV end-to-end through preview', () => {
    // pt-BR conventions -- `;` delimiter, `1.234,56` thousands-dot +
    // decimal-comma, DD/MM/YYYY dates -- are more representative of this
    // app's users than a synthetic `a,b,c` file. The heuristic in
    // `parseFlexibleAmount`/`parseFlexibleDate` (Task 1, cbca8af) reads both
    // rows correctly with no explicit `decimalSeparator`/`order`, matching
    // what the CSV parser actually calls today.
    const csvBody = [
      'Data;Descrição;Valor',
      '01/04/2026;Mercado Livre;-123,45',
      '02/04/2026;Salário;1.234,56',
    ].join('\n')

    function csvFile(
      name = 'extrato.csv',
      body = csvBody,
    ): Express.Multer.File {
      return {
        originalname: name,
        buffer: Buffer.from(body, 'utf8'),
      } as Express.Multer.File
    }

    it('preview parses a pt-BR CSV buffer into rows with cents-exact amounts', async () => {
      const r = await service.preview('user-1', 'src-1', csvFile())

      expect(r.format).toBe(ImportBatchFormat.CSV)
      expect(r.rows).toHaveLength(2)

      expect(r.rows[0].kind).toBe('EXPENSE')
      expect(r.rows[0].description).toBe('Mercado Livre')
      expect(r.rows[0].occurredAt).toMatch(/^2026-04-01/)
      // Amounts asserted in integer cents, not floats: a `'123.45'` string
      // comparison would still pass even if pt-BR decimal-comma parsing had
      // silently produced a 1000x error that happened to render the same.
      expect(toCents(r.rows[0].amount)).toBe(12345)

      expect(r.rows[1].kind).toBe('INCOME')
      expect(r.rows[1].description).toBe('Salário')
      expect(r.rows[1].occurredAt).toMatch(/^2026-04-02/)
      expect(toCents(r.rows[1].amount)).toBe(123456)

      expect(r.parserWarnings).toEqual([])
    })

    it('preview marks a CSV row as a duplicate once its fingerprint already exists', async () => {
      const first = await service.preview('user-1', 'src-1', csvFile())
      expect(first.rows[0].isDuplicate).toBe(false)

      const fp = first.rows[0].fingerprint
      prismaMock.transaction.findMany.mockResolvedValueOnce([
        { fingerprint: fp },
      ])

      const second = await service.preview('user-1', 'src-1', csvFile())

      expect(second.rows[0].isDuplicate).toBe(true)
      expect(second.duplicateCount).toBe(1)
      expect(second.newCount).toBe(second.rows.length - 1)
    })

    it('preview surfaces a parser warning for an unparsable CSV row instead of silently dropping it', async () => {
      const bodyWithBadRow = [
        'Data;Descrição;Valor',
        '01/04/2026;Mercado Livre;-123,45',
        '03/04/2026;Linha Invalida;abc',
        '02/04/2026;Salário;1.234,56',
      ].join('\n')

      const r = await service.preview(
        'user-1',
        'src-1',
        csvFile('extrato-com-erro.csv', bodyWithBadRow),
      )

      // The malformed row is dropped but now surfaced as a warning, matching
      // the Banrisul/Cresol parsers, which report `line_parse_failed` /
      // `block_parse_failed` for the equivalent case.
      expect(r.rows).toHaveLength(2)
      const w = r.parserWarnings!.find((w) => w.code === 'invalid_amount')
      expect(w).toBeDefined()
      expect(w!.severity).toBe('warning')
      expect(w!.rawLine).toContain('Linha Invalida')
    })
  })

  describe('saved CSV mapping (Stage 2, Task 4)', () => {
    // A debit/credit-column layout with a non-recognized header ("Ref",
    // "Debito", "Credito") -- the header-name heuristic in `csv-parser.ts`
    // cannot represent two separate amount columns at all (`AMOUNT_KEYS`
    // only ever names one column), so it would fall back to its positional
    // guess and read "Data" as an amount. Only a saved mapping that states
    // `sign: { kind: 'debit_credit', ... }` reads this file correctly --
    // which is what makes this fixture a real proof of "the saved mapping is
    // applied", not just "some mapping is applied".
    const savedMapping: GenericCsvMapping = {
      delimiter: ';',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 1,
      descriptionColumn: 2,
      decimalSeparator: ',',
      dateOrder: 'DMY',
      sign: { kind: 'debit_credit', debitColumn: 3, creditColumn: 4 },
    }
    const SAVED_COLUMN_COUNT = 5

    function debitCreditCsvFile(name: string, body: string): Express.Multer.File {
      return { originalname: name, buffer: Buffer.from(body, 'utf8') } as Express.Multer.File
    }

    it('reuses the saved mapping on the next import from the same source, without re-asking', async () => {
      csvSourceMappingsMock.findForSource.mockResolvedValue({
        mapping: savedMapping,
        columnCount: SAVED_COLUMN_COUNT,
      })

      const body = [
        'Ref;Data;Descricao;Debito;Credito',
        '1;05/04/2026;Mercado;123,45;',
        '2;06/04/2026;Salario;;1.234,56',
      ].join('\n')

      const r = await service.preview(
        'user-1',
        'src-1',
        debitCreditCsvFile('nubank.csv', body),
      )

      expect(csvSourceMappingsMock.findForSource).toHaveBeenCalledWith(
        'user-1',
        'src-1',
      )
      expect(r.rows).toHaveLength(2)
      expect(r.rows[0].kind).toBe('EXPENSE')
      expect(r.rows[0].description).toBe('Mercado')
      // Cents, not a string comparison -- a silent parse error here (e.g.
      // falling back to the positional heuristic, which would try to read
      // "05/04/2026" as an amount) would either throw or produce a wildly
      // different number, never a coincidentally-matching one.
      expect(toCents(r.rows[0].amount)).toBe(12345)
      expect(r.rows[1].kind).toBe('INCOME')
      expect(r.rows[1].description).toBe('Salario')
      expect(toCents(r.rows[1].amount)).toBe(123456)
      // File matches the saved shape -- no column-count-mismatch warning.
      expect(
        r.parserWarnings!.some(
          (w) => w.code === 'csv_mapping_column_count_mismatch',
        ),
      ).toBe(false)
    })

    it('warns (but still applies the mapping) when the file no longer has the saved column count', async () => {
      csvSourceMappingsMock.findForSource.mockResolvedValue({
        mapping: savedMapping,
        columnCount: SAVED_COLUMN_COUNT,
      })

      // The bank added a trailing "Saldo" (balance) column: 6 columns
      // instead of the 5 this mapping was confirmed against. The mapping's
      // column *indices* (1/2/3/4) are all still in range, so this is
      // exactly the case that could silently "look fine" without an
      // explicit check.
      const body = [
        'Ref;Data;Descricao;Debito;Credito;Saldo',
        '1;05/04/2026;Mercado;123,45;;1000,00',
      ].join('\n')

      const r = await service.preview(
        'user-1',
        'src-1',
        debitCreditCsvFile('nubank-novo-layout.csv', body),
      )

      const w = r.parserWarnings!.find(
        (w) => w.code === 'csv_mapping_column_count_mismatch',
      )
      expect(w).toBeDefined()
      expect(w!.severity).toBe('warning')
      expect(w!.message).toContain('5')
      expect(w!.message).toContain('6')

      // Never a silent misparse: the mapping is still applied and the
      // (correct, in-range) row is still returned -- the user sees both the
      // warning and the resulting preview row, and decides.
      expect(r.rows).toHaveLength(1)
      expect(toCents(r.rows[0].amount)).toBe(12345)
    })
  })

  describe('OFX end-to-end through preview', () => {
    // A minimal but realistic OFX 1.02 SGML export -- header block, SONRS
    // sign-on, and a BANKTRANLIST with two STMTTRN blocks -- matching the
    // structure `parseOfxBuffer` actually reads (DTPOSTED/TRNAMT/MEMO/NAME),
    // rather than a bare `<STMTTRN>` fragment.
    const ofxBody = [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'VERSION:102',
      'SECURITY:NONE',
      'ENCODING:USASCII',
      'CHARSET:1252',
      'COMPRESSION:NONE',
      'OLDFILEUID:NONE',
      'NEWFILEUID:NONE',
      '',
      '<OFX>',
      '<SIGNONMSGSRSV1>',
      '<SONRS>',
      '<STATUS>',
      '<CODE>0',
      '<SEVERITY>INFO',
      '</STATUS>',
      '<DTSERVER>20260402120000',
      '<LANGUAGE>POR',
      '</SONRS>',
      '</SIGNONMSGSRSV1>',
      '<BANKMSGSRSV1>',
      '<STMTTRNRS>',
      '<TRNUID>1',
      '<STATUS>',
      '<CODE>0',
      '<SEVERITY>INFO',
      '</STATUS>',
      '<STMTRS>',
      '<CURDEF>BRL',
      '<BANKACCTFROM>',
      '<BANKID>0001',
      '<ACCTID>1234567',
      '<ACCTTYPE>CHECKING',
      '</BANKACCTFROM>',
      '<BANKTRANLIST>',
      '<DTSTART>20260401120000',
      '<DTEND>20260402120000',
      '<STMTTRN>',
      '<TRNTYPE>DEBIT',
      '<DTPOSTED>20260401120000',
      '<TRNAMT>-123.45',
      '<FITID>2026040100001',
      '<MEMO>PIX DEBITO PARA FULANO',
      '</STMTTRN>',
      '<STMTTRN>',
      '<TRNTYPE>CREDIT',
      '<DTPOSTED>20260402120000',
      '<TRNAMT>1234.56',
      '<FITID>2026040200002',
      '<MEMO>SALARIO',
      '</STMTTRN>',
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
      '',
    ].join('\n')

    function ofxFile(
      name = 'extrato.ofx',
      body = ofxBody,
    ): Express.Multer.File {
      return {
        originalname: name,
        buffer: Buffer.from(body, 'utf8'),
      } as Express.Multer.File
    }

    it('preview parses a real OFX buffer into rows with cents-exact amounts', async () => {
      const r = await service.preview('user-1', 'src-1', ofxFile())

      expect(r.format).toBe(ImportBatchFormat.OFX)
      expect(r.rows).toHaveLength(2)

      expect(r.rows[0].kind).toBe('EXPENSE')
      expect(r.rows[0].description).toBe('PIX DEBITO PARA FULANO')
      expect(r.rows[0].occurredAt).toMatch(/^2026-04-01/)
      expect(toCents(r.rows[0].amount)).toBe(12345)

      expect(r.rows[1].kind).toBe('INCOME')
      expect(r.rows[1].description).toBe('SALARIO')
      expect(r.rows[1].occurredAt).toMatch(/^2026-04-02/)
      expect(toCents(r.rows[1].amount)).toBe(123456)

      expect(r.parserWarnings).toEqual([])
    })

    it('preview marks an OFX row as a duplicate once its fingerprint already exists', async () => {
      const first = await service.preview('user-1', 'src-1', ofxFile())
      expect(first.rows[0].isDuplicate).toBe(false)

      const fp = first.rows[0].fingerprint
      prismaMock.transaction.findMany.mockResolvedValueOnce([
        { fingerprint: fp },
      ])

      const second = await service.preview('user-1', 'src-1', ofxFile())

      expect(second.rows[0].isDuplicate).toBe(true)
      expect(second.duplicateCount).toBe(1)
      expect(second.newCount).toBe(second.rows.length - 1)
    })

    it('preview surfaces a parser warning for an OFX transaction missing TRNAMT instead of silently dropping it', async () => {
      const badBlock = [
        '<STMTTRN>',
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20260403120000',
        '<FITID>2026040300003',
        '<MEMO>SEM VALOR',
        '</STMTTRN>',
        '</BANKTRANLIST>',
      ].join('\n')
      const bodyWithBadBlock = ofxBody.replace('</BANKTRANLIST>', badBlock)

      const r = await service.preview(
        'user-1',
        'src-1',
        ofxFile('extrato-com-erro.ofx', bodyWithBadBlock),
      )

      // Same shape of fix as CSV above: the block without <TRNAMT> is
      // dropped but now produces a parser warning.
      expect(r.rows).toHaveLength(2)
      const w = r.parserWarnings!.find((w) => w.code === 'missing_amount')
      expect(w).toBeDefined()
      expect(w!.severity).toBe('warning')
      expect(w!.rawBlock).toContain('SEM VALOR')
    })
  })

  describe('commit', () => {
    it('persists billing and installment metadata for credit card source', async () => {
      const createdRows: Record<string, unknown>[] = []
      const planCreate = jest.fn().mockResolvedValue({ id: 'plan-1' })
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            installmentPlan: {
              create: planCreate,
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdRows.push(args.data as Record<string, unknown>)
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const result = await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-01-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            // Non-whole cents (150.45 -> 15045) so a dropped-fraction bug in
            // any of the three money write sites below would fail this test.
            amount: 150.45,
            description: 'MERCADO 01/05',
            installmentCurrent: 1,
            installmentTotal: 5,
          },
        ],
      })

      expect(result.created).toBe(5)
      expect(createdRows).toHaveLength(5)
      // installmentPlan.create (imports.service.ts write site)
      expect(planCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountEachCents: 15045,
        }),
      })
      expect(createdRows[0]).toMatchObject({
        billingCycleMonth: 1,
        billingCycleYear: 2024,
        installmentCurrent: 1,
        installmentTotal: 5,
        isProjected: false,
        isConfirmedFromImport: true,
        installmentPlanId: 'plan-1',
        occurredAt: new Date('2024-01-10T00:00:00.000Z'),
        // transaction.create for the imported (non-projected) leg
        amountCents: 15045,
      })
      expect(createdRows[0].expectedDueDate).toEqual(
        new Date(Date.UTC(2024, 1, 10)),
      )
      expect(createdRows[1]).toMatchObject({
        isProjected: true,
        installmentCurrent: 2,
        installmentTotal: 5,
        importBatchId: null,
        installmentPlanId: 'plan-1',
        // transaction.create for a projected installment leg
        amountCents: 15045,
      })
      expect(createdRows[1].billingCycleMonth).toBe(2)
      expect(createdRows[4]).toMatchObject({
        isProjected: true,
        isConfirmedFromImport: false,
        installmentCurrent: 5,
      })
    })

    it('does not persist installment fields for non–credit-card source', async () => {
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.BANK_ACCOUNT,
                closingDay: null,
                dueDay: null,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.csv',
        format: ImportBatchFormat.CSV,
        rows: [
          {
            occurredAt: '2024-01-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'X',
            installmentCurrent: 1,
            installmentTotal: 5,
          },
        ],
      })

      expect(createdData).toMatchObject({
        billingCycleMonth: null,
        billingCycleYear: null,
        expectedDueDate: null,
        installmentCurrent: null,
        installmentTotal: null,
      })
      expect(createdData?.isConfirmedFromImport).toBe(true)
    })

    it('persists billing from statementBilling snapshot for credit card', async () => {
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        statementBilling: {
          paymentDueDate: '2026-04-06',
          statementClosingDate: '2026-03-25',
        },
        rows: [
          {
            occurredAt: '2026-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'X',
          },
        ],
      })

      expect(createdData?.billingCycleMonth).toBe(3)
      expect(createdData?.billingCycleYear).toBe(2026)
      expect(createdData?.expectedDueDate).toEqual(
        new Date(Date.UTC(2026, 3, 6, 12, 0, 0)),
      )
    })

    it('derives billing cycle from due only when statement closing omitted', async () => {
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        statementBilling: { paymentDueDate: '2026-04-06' },
        rows: [
          {
            occurredAt: '2026-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'X',
          },
        ],
      })

      expect(createdData?.billingCycleMonth).toBe(3)
      expect(createdData?.billingCycleYear).toBe(2026)
    })

    it('does not assign expense-only other fallback to INCOME rows', async () => {
      categorizationRulesMock.loadSystemResolutionContext.mockResolvedValue({
        categoryIdByKey: new Map([['other', 'cat-other']]),
      })
      const categoryFindFirst = jest.fn()
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.BANK_ACCOUNT,
                closingDay: null,
                dueDay: null,
              }),
            },
            category: { findFirst: categoryFindFirst },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'nubank.csv',
        format: ImportBatchFormat.CSV,
        rows: [
          {
            occurredAt: '2024-01-10T00:00:00.000Z',
            kind: TransactionKind.INCOME,
            amount: 100,
            description: 'Pagamento recebido',
          },
        ],
      })

      expect(categoryFindFirst).not.toHaveBeenCalled()
      expect(createdData?.categoryId).toBeNull()
    })

    it('still assigns expense other fallback for EXPENSE rows when rules miss', async () => {
      categorizationRulesMock.loadSystemResolutionContext.mockResolvedValue({
        categoryIdByKey: new Map([['other', 'cat-other']]),
      })
      const categoryFindFirst = jest.fn().mockResolvedValue({
        id: 'cat-other',
        type: CategoryType.EXPENSE,
        userId: 'user-1',
      })
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.BANK_ACCOUNT,
                closingDay: null,
                dueDay: null,
              }),
            },
            category: { findFirst: categoryFindFirst },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.csv',
        format: ImportBatchFormat.CSV,
        rows: [
          {
            occurredAt: '2024-01-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'X',
          },
        ],
      })

      expect(categoryFindFirst).toHaveBeenCalled()
      expect(createdData?.categoryId).toBe('cat-other')
    })

    it('ignores invalid installment pair on commit without failing', async () => {
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdData = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-12-05T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 20,
            description: 'Y',
            installmentCurrent: 13,
            installmentTotal: 5,
          },
        ],
      })

      expect(createdData).toMatchObject({
        installmentCurrent: null,
        installmentTotal: null,
        billingCycleMonth: 12,
        billingCycleYear: 2024,
      })
    })

    it('projects only later legs when importing 2/5', async () => {
      const createdRows: Record<string, unknown>[] = []
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            installmentPlan: {
              create: jest.fn().mockResolvedValue({ id: 'plan-2' }),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: unknown }) => {
                createdRows.push(args.data as Record<string, unknown>)
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const result = await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'PAY',
            installmentCurrent: 2,
            installmentTotal: 5,
          },
        ],
      })

      expect(result.created).toBe(4)
      expect(createdRows.map((r) => r.installmentCurrent)).toEqual([
        2, 3, 4, 5,
      ])
      expect(createdRows.filter((r) => r.isProjected === true)).toHaveLength(3)
    })

    it('does not duplicate projected rows when re-committing the same import row', async () => {
      const fpSeen = new Set<string>()
      let createCount = 0
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            installmentPlan: {
              create: jest.fn().mockResolvedValue({ id: 'plan-dup' }),
            },
            transaction: {
              findFirst: jest.fn().mockImplementation((args: { where: { fingerprint?: string } }) => {
                const fp = args.where.fingerprint
                if (fp && fpSeen.has(fp)) return { id: 'exists' }
                return null
              }),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: { fingerprint?: string } }) => {
                const fp = args.data.fingerprint
                if (fp) fpSeen.add(fp)
                createCount++
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const row = {
        occurredAt: '2024-01-10T00:00:00.000Z',
        kind: TransactionKind.EXPENSE,
        amount: 10,
        description: 'MERCADO',
        installmentCurrent: 1,
        installmentTotal: 3,
      }
      const dto = {
        sourceId: 'src-1',
        fileName: 'a.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [row],
      }

      await service.commit('user-1', dto)
      expect(createCount).toBe(3)

      createCount = 0
      const r2 = await service.commit('user-1', { ...dto, fileName: 'b.pdf' })
      expect(r2.skippedDuplicates).toBe(1)
      expect(createCount).toBe(0)
    })

    it('reconciles a projected installment with the next import instead of creating a duplicate', async () => {
      const createMock = jest.fn()
      let updatePayload: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-2' }),
            },
            installmentPlan: {
              create: jest.fn(),
            },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([
                {
                  id: 'proj-2',
                  description: 'MERCADO · 2/5 (projected)',
                },
              ]),
              create: createMock,
              update: jest.fn().mockImplementation((args: { data: unknown }) => {
                updatePayload = args.data as Record<string, unknown>
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const result = await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'feb.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'MERCADO',
            installmentCurrent: 2,
            installmentTotal: 5,
          },
        ],
      })

      expect(createMock).not.toHaveBeenCalled()
      expect(result.created).toBe(1)
      expect(updatePayload).toMatchObject({
        isProjected: false,
        isConfirmedFromImport: true,
        importBatchId: 'batch-2',
        description: 'MERCADO',
      })
    })

    it('creates a new installment plan when no projected leg matches', async () => {
      const planCreate = jest.fn().mockResolvedValue({ id: 'plan-new' })
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-3' }),
            },
            installmentPlan: { create: planCreate },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockResolvedValue({}),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'MERCADO',
            installmentCurrent: 2,
            installmentTotal: 5,
          },
        ],
      })

      expect(planCreate).toHaveBeenCalled()
    })

    it('skips reconciliation when description does not match the projected leg', async () => {
      const planCreate = jest.fn().mockResolvedValue({ id: 'plan-y' })
      const updateMock = jest.fn()
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-4' }),
            },
            installmentPlan: { create: planCreate },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([
                {
                  id: 'p',
                  description: 'OTHER · 2/5 (projected)',
                },
              ]),
              create: jest.fn().mockResolvedValue({}),
              update: updateMock,
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'MERCADO',
            installmentCurrent: 2,
            installmentTotal: 5,
          },
        ],
      })

      expect(updateMock).not.toHaveBeenCalled()
      expect(planCreate).toHaveBeenCalled()
    })

    it('skips reconciliation when two projected rows tie on description (ambiguous)', async () => {
      const planCreate = jest.fn().mockResolvedValue({ id: 'plan-z' })
      const updateMock = jest.fn()
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-5' }),
            },
            installmentPlan: { create: planCreate },
            transaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([
                { id: 'a', description: 'MERCADO · 2/5 (projected)' },
                { id: 'b', description: 'MERCADO · 2/5 (projected)' },
              ]),
              create: jest.fn().mockResolvedValue({}),
              update: updateMock,
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'x.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [
          {
            occurredAt: '2024-02-10T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 10,
            description: 'MERCADO',
            installmentCurrent: 2,
            installmentTotal: 5,
          },
        ],
      })

      expect(updateMock).not.toHaveBeenCalled()
      expect(planCreate).toHaveBeenCalled()
    })

    it('after reconciliation, re-importing the same row is a fingerprint duplicate', async () => {
      const fpSeen = new Set<string>()
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-r' }),
            },
            installmentPlan: { create: jest.fn() },
            transaction: {
              findFirst: jest.fn().mockImplementation((args: { where: { fingerprint?: string } }) => {
                const fp = args.where.fingerprint
                return fp && fpSeen.has(fp) ? { id: 'dup' } : null
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'proj-2', description: 'M · 2/3 (projected)' },
              ]),
              create: jest.fn().mockImplementation((args: { data: { fingerprint?: string } }) => {
                if (args.data.fingerprint) fpSeen.add(args.data.fingerprint)
                return {}
              }),
              update: jest.fn().mockImplementation((args: { data: { fingerprint?: string } }) => {
                if (args.data.fingerprint) fpSeen.add(args.data.fingerprint)
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.CREDIT_CARD,
                closingDay: 25,
                dueDay: 10,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const row = {
        occurredAt: '2024-02-10T00:00:00.000Z',
        kind: TransactionKind.EXPENSE,
        amount: 10,
        description: 'M',
        installmentCurrent: 2,
        installmentTotal: 3,
      }

      await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'once.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [row],
      })

      const r2 = await service.commit('user-1', {
        sourceId: 'src-1',
        fileName: 'twice.pdf',
        format: ImportBatchFormat.PDF_BANRISUL_CC,
        rows: [row],
      })

      expect(r2.skippedDuplicates).toBe(1)
    })

    it('links the created transaction to the ImportBatch and skips a duplicate re-commit for CSV', async () => {
      const fpSeen = new Set<string>()
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-csv-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockImplementation((args: { where: { fingerprint?: string } }) => {
                const fp = args.where.fingerprint
                return fp && fpSeen.has(fp) ? { id: 'exists' } : null
              }),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
                createdData = args.data
                const fp = args.data.fingerprint as string | undefined
                if (fp) fpSeen.add(fp)
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.BANK_ACCOUNT,
                closingDay: null,
                dueDay: null,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const dto = {
        sourceId: 'src-1',
        fileName: 'extrato.csv',
        format: ImportBatchFormat.CSV,
        rows: [
          {
            occurredAt: '2026-04-01T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 123.45,
            description: 'Mercado Livre',
          },
        ],
      }

      const first = await service.commit('user-1', dto)
      expect(first.importBatchId).toBe('batch-csv-1')
      expect(first.created).toBe(1)
      expect(createdData).toMatchObject({
        importBatchId: 'batch-csv-1',
        amountCents: 12345,
      })

      const second = await service.commit('user-1', {
        ...dto,
        fileName: 'extrato-again.csv',
      })
      expect(second.skippedDuplicates).toBe(1)
      expect(second.created).toBe(0)
    })

    it('links the created transaction to the ImportBatch and skips a duplicate re-commit for OFX', async () => {
      const fpSeen = new Set<string>()
      let createdData: Record<string, unknown> | undefined
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-ofx-1' }),
            },
            transaction: {
              findFirst: jest.fn().mockImplementation((args: { where: { fingerprint?: string } }) => {
                const fp = args.where.fingerprint
                return fp && fpSeen.has(fp) ? { id: 'exists' } : null
              }),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
                createdData = args.data
                const fp = args.data.fingerprint as string | undefined
                if (fp) fpSeen.add(fp)
                return {}
              }),
            },
            source: {
              findFirst: jest.fn().mockResolvedValue({
                type: SourceType.BANK_ACCOUNT,
                closingDay: null,
                dueDay: null,
              }),
            },
            category: { findFirst: jest.fn() },
          }
          return fn(tx)
        },
      )

      const dto = {
        sourceId: 'src-1',
        fileName: 'extrato.ofx',
        format: ImportBatchFormat.OFX,
        rows: [
          {
            occurredAt: '2026-04-01T00:00:00.000Z',
            kind: TransactionKind.EXPENSE,
            amount: 123.45,
            description: 'PIX DEBITO PARA FULANO',
          },
        ],
      }

      const first = await service.commit('user-1', dto)
      expect(first.importBatchId).toBe('batch-ofx-1')
      expect(first.created).toBe(1)
      expect(createdData).toMatchObject({
        importBatchId: 'batch-ofx-1',
        amountCents: 12345,
      })

      const second = await service.commit('user-1', {
        ...dto,
        fileName: 'extrato-again.ofx',
      })
      expect(second.skippedDuplicates).toBe(1)
      expect(second.created).toBe(0)
    })
  })

  it('preview maps Cresol PDF buffer entrypoint result to the same rows as the import path', async () => {
    const body = `
CRESOL
Extrato de Conta Corrente
Agência 0001

03/04/2025 SAQUE - R$ 7,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const fromPdf = await parseCresolStatementPdf(buf)
    const file = {
      originalname: 'c3.pdf',
      buffer: buf,
    } as Express.Multer.File
    const preview = await service.preview('user-1', 'src-1', file)

    expect(preview.rows).toHaveLength(fromPdf.transactions.length)
    expect(preview.rows[0].amount).toBe(
      Math.abs(fromPdf.transactions[0].signedAmount).toFixed(2),
    )
    expect(preview.rows[0].description).toBe(
      fromPdf.transactions[0].description.trim().slice(0, 512),
    )
  })

  it('preview returns block_parse_failed warnings when one Cresol block is malformed', async () => {
    const body = `
CRESOL
Extrato de Conta Corrente
Agência 0001

04/04/2025 FIRST - R$ 10,00
05/04/2025 NO AMOUNT LINE
06/04/2025 THIRD - R$ 5,00
${'note '.repeat(30)}
`.trim()
    const buf = await buildPdfBufferFromPlainText(body)
    const file = {
      originalname: 'c4.pdf',
      buffer: buf,
    } as Express.Multer.File

    const r = await service.preview('user-1', 'src-1', file)

    expect(r.format).toBe(ImportBatchFormat.PDF_CRESOL_STATEMENT)
    expect(r.rows).toHaveLength(2)
    expect(r.parserWarnings!.some((w) => w.code === 'block_parse_failed')).toBe(
      true,
    )
  })
})
