import { Test } from '@nestjs/testing'
import { SourceType, toCents } from '@wimm/shared'
import { AiKeyResolverService } from '../ai/ai-key-resolver.service'
import { AnthropicCategorizerService } from '../ai/anthropic-categorizer.service'
import { CategorizationRulesService } from '../categorization-rules/categorization-rules.service'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { PrismaService } from '../prisma/prisma.service'
import { CsvSourceMappingService } from './csv-source-mapping.service'
import { ImportsService } from './imports.service'

/**
 * Integration-style proof (Stage 2, Task 4 mutation proof #1): wires the
 * *real* `ImportsService` to the *real* `CsvSourceMappingService` -- only
 * Prisma is faked, with an in-memory backing store, so a mapping saved
 * through `upsertForSource` is genuinely read back by `preview()` on the
 * next import, not merely asserted against a mocked return value (that
 * weaker style already lives in `imports.service.spec.ts`'s "saved CSV
 * mapping" describe block; this spec is the "no, it's actually the same
 * lookup" complement).
 *
 * "Import a second file from the same source" is literal here: two
 * different files are parsed via `service.preview` for the same `sourceId`,
 * after the mapping was saved once.
 */
describe('CSV mapping reuse across imports (real ImportsService + real CsvSourceMappingService)', () => {
  let importsService: ImportsService
  let csvSourceMappingService: CsvSourceMappingService

  const SOURCE_ID = 'src-int-1'
  const USER_ID = 'user-int-1'

  function createFakePrisma() {
    let mappingRow: Record<string, unknown> | null = null
    return {
      source: {
        // Both callers (ImportsService.preview, CsvSourceMappingService
        // .upsertForSource) only ever check for existence/ownership and
        // read `type` -- a fixed BANK_ACCOUNT row for the one seeded
        // (sourceId, userId) pair is enough for both call sites.
        findFirst: jest.fn(
          async ({ where }: { where: { id: string; userId: string } }) => {
            if (where.id !== SOURCE_ID || where.userId !== USER_ID) return null
            return { id: SOURCE_ID, type: SourceType.BANK_ACCOUNT }
          },
        ),
      },
      csvSourceMapping: {
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: { sourceId: string; source: { userId: string } }
          }) => {
            if (!mappingRow) return null
            if (mappingRow.sourceId !== where.sourceId) return null
            return mappingRow
          },
        ),
        upsert: jest.fn(
          async ({
            create,
            update,
          }: {
            where: { sourceId: string }
            create: Record<string, unknown>
            update: Record<string, unknown>
          }) => {
            mappingRow = mappingRow ? { ...mappingRow, ...update } : { ...create }
            return mappingRow
          },
        ),
      },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
    }
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportsService,
        CsvSourceMappingService,
        { provide: PrismaService, useValue: createFakePrisma() },
        {
          provide: DefaultCategoriesService,
          useValue: { ensureForUser: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CategorizationRulesService,
          useValue: {
            loadActiveRulesWithCategories: jest.fn().mockResolvedValue([]),
            loadSystemResolutionContext: jest.fn().mockResolvedValue({}),
            resolveCategoryIdWithSystem: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: AiKeyResolverService,
          useValue: { resolveForUser: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AnthropicCategorizerService,
          useValue: { categorizeBatch: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile()

    importsService = moduleRef.get(ImportsService)
    csvSourceMappingService = moduleRef.get(CsvSourceMappingService)
  })

  function debitCreditCsvFile(name: string, body: string): Express.Multer.File {
    return { originalname: name, buffer: Buffer.from(body, 'utf8') } as Express.Multer.File
  }

  it('saves a mapping once, then a second import from the same source applies it without re-asking', async () => {
    // Step 1: save the mapping (the user maps columns once).
    await csvSourceMappingService.upsertForSource(
      USER_ID,
      SOURCE_ID,
      {
        delimiter: ';',
        hasHeader: true,
        encoding: 'utf8',
        dateColumn: 1,
        descriptionColumn: 2,
        decimalSeparator: ',',
        dateOrder: 'DMY',
        sign: { kind: 'debit_credit', debitColumn: 3, creditColumn: 4 },
      },
      5,
    )

    // Step 2: import a FIRST file from this source -- proves the mapping is
    // already applied on the very next import, no re-confirmation step.
    const firstBody = [
      'Ref;Data;Descricao;Debito;Credito',
      '1;05/04/2026;Mercado;123,45;',
    ].join('\n')
    const first = await importsService.preview(
      USER_ID,
      SOURCE_ID,
      debitCreditCsvFile('abril.csv', firstBody),
    )
    expect(first.rows).toHaveLength(1)
    expect(first.rows[0].kind).toBe('EXPENSE')
    expect(toCents(first.rows[0].amount)).toBe(12345)

    // Step 3: import a SECOND, different file from the same source. Nobody
    // called anything mapping-related between step 2 and here -- if this
    // still parses correctly, the saved mapping was reused, not re-asked.
    const secondBody = [
      'Ref;Data;Descricao;Debito;Credito',
      '2;06/04/2026;Salario;;1.234,56',
    ].join('\n')
    const second = await importsService.preview(
      USER_ID,
      SOURCE_ID,
      debitCreditCsvFile('maio.csv', secondBody),
    )

    expect(second.rows).toHaveLength(1)
    expect(second.rows[0].kind).toBe('INCOME')
    expect(second.rows[0].description).toBe('Salario')
    expect(toCents(second.rows[0].amount)).toBe(123456)
  })
})
