import { Test } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service'
import {
  CsvSourceMappingService,
  InvalidStoredCsvMappingError,
} from './csv-source-mapping.service'
import type { GenericCsvMapping } from './parsers/generic-csv-mapper'

/** A row shaped exactly like what `prisma.csvSourceMapping.findFirst` would
 * return, but with an arbitrary `signConfig` string -- used to plant a
 * corrupted blob directly at the Prisma boundary, bypassing
 * `upsertForSource` entirely (an older app version, a hand-edited row, or a
 * partially restored backup would all land here the same way). */
function rowWithSignConfig(signConfig: string) {
  return {
    delimiter: ';',
    hasHeader: true,
    encoding: 'utf8',
    dateColumn: 0,
    descriptionColumn: 1,
    decimalSeparator: ',',
    dateOrder: 'DMY',
    signConfig,
    columnCount: 3,
  }
}

describe('CsvSourceMappingService', () => {
  let service: CsvSourceMappingService
  const prismaMock = {
    source: { findFirst: jest.fn() },
    csvSourceMapping: { findFirst: jest.fn(), upsert: jest.fn() },
  }

  const signedAmountMapping: GenericCsvMapping = {
    delimiter: ';',
    hasHeader: true,
    encoding: 'utf8',
    dateColumn: 0,
    descriptionColumn: 1,
    decimalSeparator: ',',
    dateOrder: 'DMY',
    sign: { kind: 'signed_amount', amountColumn: 2 },
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const moduleRef = await Test.createTestingModule({
      providers: [
        CsvSourceMappingService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile()

    service = moduleRef.get(CsvSourceMappingService)
  })

  describe('findForSource', () => {
    it('returns null when no mapping is saved for the source', async () => {
      prismaMock.csvSourceMapping.findFirst.mockResolvedValue(null)

      const result = await service.findForSource('user-1', 'src-1')

      expect(result).toBeNull()
      expect(prismaMock.csvSourceMapping.findFirst).toHaveBeenCalledWith({
        where: { sourceId: 'src-1', source: { userId: 'user-1' } },
      })
    })

    it('reconstructs the GenericCsvMapping shape (including the sign union) from the stored row', async () => {
      prismaMock.csvSourceMapping.findFirst.mockResolvedValue({
        delimiter: ';',
        hasHeader: true,
        encoding: 'utf8',
        dateColumn: 0,
        descriptionColumn: 1,
        decimalSeparator: ',',
        dateOrder: 'DMY',
        signConfig: JSON.stringify({
          kind: 'debit_credit',
          debitColumn: 2,
          creditColumn: 3,
        }),
        columnCount: 4,
      })

      const result = await service.findForSource('user-1', 'src-1')

      expect(result).toEqual({
        mapping: {
          delimiter: ';',
          hasHeader: true,
          encoding: 'utf8',
          dateColumn: 0,
          descriptionColumn: 1,
          decimalSeparator: ',',
          dateOrder: 'DMY',
          sign: { kind: 'debit_credit', debitColumn: 2, creditColumn: 3 },
        },
        columnCount: 4,
      })
    })

    it('rejects a corrupted signConfig blob (invalid JSON) instead of returning a malformed mapping', async () => {
      prismaMock.csvSourceMapping.findFirst.mockResolvedValue(
        rowWithSignConfig('not valid json{{{'),
      )

      await expect(service.findForSource('user-1', 'src-1')).rejects.toThrow(
        InvalidStoredCsvMappingError,
      )
    })

    // Fix round 1: validation on read, not just on write. Each of these three
    // blobs is syntactically valid JSON -- `JSON.parse` alone would let all
    // three through -- but none is a valid `GenericCsvSignConvention`. Each
    // is written directly into `signConfig`, bypassing `upsertForSource`
    // (and therefore its own `validateMapping` call) entirely, exactly as a
    // corrupted row from an older app version, a hand edit, or a partially
    // restored backup would arrive.
    describe('validates a syntactically-valid-JSON but semantically invalid sign blob', () => {
      it('rejects {"kind":"debit_credit","amountColumn":1} (wrong shape for its own kind)', async () => {
        prismaMock.csvSourceMapping.findFirst.mockResolvedValue(
          rowWithSignConfig(
            JSON.stringify({ kind: 'debit_credit', amountColumn: 1 }),
          ),
        )

        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(InvalidStoredCsvMappingError)
        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(/no longer valid/i)
      })

      it('rejects {"kind":"nonsense"} (unrecognized kind)', async () => {
        prismaMock.csvSourceMapping.findFirst.mockResolvedValue(
          rowWithSignConfig(JSON.stringify({ kind: 'nonsense' })),
        )

        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(InvalidStoredCsvMappingError)
        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(/no longer valid/i)
      })

      it('rejects {} (no kind at all)', async () => {
        prismaMock.csvSourceMapping.findFirst.mockResolvedValue(
          rowWithSignConfig(JSON.stringify({})),
        )

        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(InvalidStoredCsvMappingError)
        await expect(
          service.findForSource('user-1', 'src-1'),
        ).rejects.toThrow(/no longer valid/i)
      })

      it('names the source in the error message, for a caller that wants to offer re-mapping', async () => {
        prismaMock.csvSourceMapping.findFirst.mockResolvedValue(
          rowWithSignConfig(JSON.stringify({})),
        )

        await expect(
          service.findForSource('user-1', 'src-42'),
        ).rejects.toThrow(/source src-42/)
      })
    })
  })

  describe('upsertForSource', () => {
    it('rejects a source that does not belong to the user', async () => {
      prismaMock.source.findFirst.mockResolvedValue(null)

      await expect(
        service.upsertForSource('user-1', 'src-1', signedAmountMapping, 3),
      ).rejects.toThrow('Invalid source')

      expect(prismaMock.csvSourceMapping.upsert).not.toHaveBeenCalled()
    })

    it('rejects an invalid mapping (the unrepresentable-in-TypeScript case, still reachable at runtime) before writing anything', async () => {
      prismaMock.source.findFirst.mockResolvedValue({ id: 'src-1' })

      // Not constructible through the GenericCsvSignConvention union in
      // TypeScript, but exactly the shape an HTTP payload can send: a
      // debit_credit mapping with debitColumn === creditColumn.
      const invalidMapping = {
        ...signedAmountMapping,
        sign: { kind: 'debit_credit', debitColumn: 2, creditColumn: 2 },
      } as unknown as GenericCsvMapping

      await expect(
        service.upsertForSource('user-1', 'src-1', invalidMapping, 3),
      ).rejects.toThrow(/must be different columns/i)

      expect(prismaMock.csvSourceMapping.upsert).not.toHaveBeenCalled()
    })

    it('rejects a non-positive columnCount', async () => {
      prismaMock.source.findFirst.mockResolvedValue({ id: 'src-1' })

      await expect(
        service.upsertForSource('user-1', 'src-1', signedAmountMapping, 0),
      ).rejects.toThrow('columnCount must be a positive integer')

      expect(prismaMock.csvSourceMapping.upsert).not.toHaveBeenCalled()
    })

    it('upserts on sourceId, JSON-encoding the sign union as one opaque column', async () => {
      prismaMock.source.findFirst.mockResolvedValue({ id: 'src-1' })
      prismaMock.csvSourceMapping.upsert.mockResolvedValue({
        delimiter: ';',
        hasHeader: true,
        encoding: 'utf8',
        dateColumn: 0,
        descriptionColumn: 1,
        decimalSeparator: ',',
        dateOrder: 'DMY',
        signConfig: JSON.stringify(signedAmountMapping.sign),
        columnCount: 3,
      })

      const result = await service.upsertForSource(
        'user-1',
        'src-1',
        signedAmountMapping,
        3,
      )

      expect(prismaMock.csvSourceMapping.upsert).toHaveBeenCalledWith({
        where: { sourceId: 'src-1' },
        create: {
          sourceId: 'src-1',
          delimiter: ';',
          hasHeader: true,
          encoding: 'utf8',
          dateColumn: 0,
          descriptionColumn: 1,
          decimalSeparator: ',',
          dateOrder: 'DMY',
          signConfig: JSON.stringify({ kind: 'signed_amount', amountColumn: 2 }),
          columnCount: 3,
        },
        update: {
          delimiter: ';',
          hasHeader: true,
          encoding: 'utf8',
          dateColumn: 0,
          descriptionColumn: 1,
          decimalSeparator: ',',
          dateOrder: 'DMY',
          signConfig: JSON.stringify({ kind: 'signed_amount', amountColumn: 2 }),
          columnCount: 3,
        },
      })
      expect(result.mapping.sign).toEqual({
        kind: 'signed_amount',
        amountColumn: 2,
      })
    })
  })
})
