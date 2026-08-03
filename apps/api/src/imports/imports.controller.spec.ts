import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ImportsController } from './imports.controller'
import { ImportsService } from './imports.service'
import {
  CsvSourceMappingService,
  InvalidStoredCsvMappingError,
} from './csv-source-mapping.service'
import type { SaveCsvSourceMappingDto } from './dto/csv-source-mapping.dto'

describe('ImportsController (csv mapping routes)', () => {
  let controller: ImportsController
  const importsServiceMock = { preview: jest.fn(), commit: jest.fn() }
  const csvSourceMappingsMock = {
    findForSource: jest.fn(),
    upsertForSource: jest.fn(),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      controllers: [ImportsController],
      providers: [
        { provide: ImportsService, useValue: importsServiceMock },
        { provide: CsvSourceMappingService, useValue: csvSourceMappingsMock },
      ],
    }).compile()

    controller = moduleRef.get(ImportsController)
  })

  it('getCsvMapping delegates to CsvSourceMappingService.findForSource, scoped to the caller', async () => {
    csvSourceMappingsMock.findForSource.mockResolvedValue({
      mapping: { delimiter: ';' },
      columnCount: 3,
    })

    const result = await controller.getCsvMapping(
      { sub: 'user-1', email: 'a@b.com', username: 'a' },
      'src-1',
    )

    expect(csvSourceMappingsMock.findForSource).toHaveBeenCalledWith(
      'user-1',
      'src-1',
    )
    expect(result).toEqual({ mapping: { delimiter: ';' }, columnCount: 3 })
  })

  it('getCsvMapping turns a corrupted stored mapping into a 400 naming the situation, not a raw 500 (fix round 1)', async () => {
    csvSourceMappingsMock.findForSource.mockRejectedValue(
      new InvalidStoredCsvMappingError('src-1', 'unrecognized kind "nonsense"'),
    )

    await expect(
      controller.getCsvMapping(
        { sub: 'user-1', email: 'a@b.com', username: 'a' },
        'src-1',
      ),
    ).rejects.toThrow(BadRequestException)
    await expect(
      controller.getCsvMapping(
        { sub: 'user-1', email: 'a@b.com', username: 'a' },
        'src-1',
      ),
    ).rejects.toThrow(/no longer valid/i)
  })

  it('getCsvMapping re-throws any other error unchanged', async () => {
    csvSourceMappingsMock.findForSource.mockRejectedValue(
      new Error('unrelated database failure'),
    )

    await expect(
      controller.getCsvMapping(
        { sub: 'user-1', email: 'a@b.com', username: 'a' },
        'src-1',
      ),
    ).rejects.toThrow('unrelated database failure')
  })

  it('saveCsvMapping strips columnCount out of the mapping payload before delegating', async () => {
    const dto: SaveCsvSourceMappingDto = {
      delimiter: ';',
      hasHeader: true,
      encoding: 'utf8',
      dateColumn: 0,
      descriptionColumn: 1,
      decimalSeparator: ',',
      dateOrder: 'DMY',
      sign: { kind: 'signed_amount', amountColumn: 2 },
      columnCount: 3,
    }
    csvSourceMappingsMock.upsertForSource.mockResolvedValue({
      mapping: dto,
      columnCount: 3,
    })

    await controller.saveCsvMapping(
      { sub: 'user-1', email: 'a@b.com', username: 'a' },
      'src-1',
      dto,
    )

    expect(csvSourceMappingsMock.upsertForSource).toHaveBeenCalledWith(
      'user-1',
      'src-1',
      {
        delimiter: ';',
        hasHeader: true,
        encoding: 'utf8',
        dateColumn: 0,
        descriptionColumn: 1,
        decimalSeparator: ',',
        dateOrder: 'DMY',
        sign: { kind: 'signed_amount', amountColumn: 2 },
      },
      3,
    )
  })
})
