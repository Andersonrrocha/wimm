import { Test } from '@nestjs/testing'
import {
  CategoryType,
  ImportBatchFormat,
  SourceType,
  TransactionKind,
} from '@prisma/client'
import { ImportsService } from './imports.service'
import { PrismaService } from '../prisma/prisma.service'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { CategorizationRulesService } from '../categorization-rules/categorization-rules.service'
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

  beforeEach(async () => {
    jest.clearAllMocks()
    categorizationRulesMock.loadActiveRulesWithCategories.mockResolvedValue([])
    categorizationRulesMock.loadSystemResolutionContext.mockResolvedValue({})
    categorizationRulesMock.resolveCategoryIdWithSystem.mockReturnValue(null)
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

  describe('commit', () => {
    it('persists billing and installment metadata for credit card source', async () => {
      const createdRows: Record<string, unknown>[] = []
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: object) => Promise<unknown>) => {
          const tx = {
            importBatch: {
              create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            },
            installmentPlan: {
              create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
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
            amount: 10,
            description: 'MERCADO 01/05',
            installmentCurrent: 1,
            installmentTotal: 5,
          },
        ],
      })

      expect(result.created).toBe(5)
      expect(createdRows).toHaveLength(5)
      expect(createdRows[0]).toMatchObject({
        billingCycleMonth: 1,
        billingCycleYear: 2024,
        installmentCurrent: 1,
        installmentTotal: 5,
        isProjected: false,
        isConfirmedFromImport: true,
        installmentPlanId: 'plan-1',
        occurredAt: new Date('2024-01-10T00:00:00.000Z'),
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
