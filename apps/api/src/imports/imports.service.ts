import {
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  CategoryType,
  ImportBatchFormat,
  Prisma,
  TransactionKind,
} from '@prisma/client'
import { CategorizationRulesService } from '../categorization-rules/categorization-rules.service'
import { PrismaService } from '../prisma/prisma.service'
import { computeImportFingerprint } from './fingerprint'
import type { ParsedLedgerRow } from './parsers/csv-parser'
import { parseCsvBuffer } from './parsers/csv-parser'
import { parseOfxBuffer } from './parsers/ofx-parser'
import type { CommitImportDto } from './dto/commit-import.dto'

const MAX_IMPORT_ROWS = 10_000

function detectFormat(fileName: string): ImportBatchFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) {
    return ImportBatchFormat.CSV
  }
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) {
    return ImportBatchFormat.OFX
  }
  throw new BadRequestException(
    'Only .csv, .ofx, or .qfx files are supported',
  )
}

function toNormalized(row: ParsedLedgerRow): {
  occurredAt: Date
  kind: TransactionKind
  amountAbs: number
  description: string
} {
  const signed = row.signedAmount
  const kind = signed >= 0 ? TransactionKind.INCOME : TransactionKind.EXPENSE
  const amountAbs = Math.abs(signed)
  if (amountAbs < 0.01) {
    throw new BadRequestException('Each row amount must be at least 0.01')
  }
  return {
    occurredAt: row.occurredAt,
    kind,
    amountAbs,
    description: row.description.slice(0, 512),
  }
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categorizationRules: CategorizationRulesService,
  ) {}

  async preview(
    userId: string,
    sourceId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required')
    }

    await this.assertSourceOwned(userId, sourceId)

    const format = detectFormat(file.originalname)
    const parsed =
      format === ImportBatchFormat.CSV
        ? parseCsvBuffer(file.buffer)
        : parseOfxBuffer(file.buffer)

    if (parsed.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `File has more than ${MAX_IMPORT_ROWS} rows; split the file`,
      )
    }

    const normalized = parsed.map((r) => toNormalized(r))

    const fingerprints = normalized.map((n) =>
      computeImportFingerprint(
        userId,
        sourceId,
        n.occurredAt,
        n.kind,
        n.amountAbs,
        n.description,
      ),
    )

    const existing = await this.prisma.transaction.findMany({
      where: {
        userId,
        fingerprint: { in: fingerprints },
      },
      select: { fingerprint: true },
    })
    const dupSet = new Set(
      existing.map((e) => e.fingerprint).filter(Boolean) as string[],
    )

    const rules =
      await this.categorizationRules.loadActiveRulesWithCategories(userId)

    const rows = normalized.map((n, i) => {
      const fingerprint = fingerprints[i]
      const isDuplicate = dupSet.has(fingerprint)
      const suggestedCategoryId =
        this.categorizationRules.resolveCategoryId(
          n.kind,
          n.description,
          rules,
        ) ?? null
      return {
        occurredAt: n.occurredAt.toISOString(),
        kind: n.kind,
        amount: n.amountAbs.toFixed(2),
        description: n.description,
        fingerprint,
        isDuplicate,
        suggestedCategoryId,
      }
    })

    const duplicateCount = rows.filter((r) => r.isDuplicate).length
    const newCount = rows.length - duplicateCount

    return {
      format,
      fileName: file.originalname,
      rows,
      totalParsed: rows.length,
      duplicateCount,
      newCount,
    }
  }

  async commit(userId: string, dto: CommitImportDto) {
    await this.assertSourceOwned(userId, dto.sourceId)

    const rules =
      await this.categorizationRules.loadActiveRulesWithCategories(userId)

    const result = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          userId,
          sourceId: dto.sourceId,
          fileName: dto.fileName,
          format: dto.format,
          status: 'COMPLETED',
        },
      })

      let created = 0
      let skippedDuplicates = 0

      for (const row of dto.rows) {
        const occurredAt = new Date(row.occurredAt)
        const fp = computeImportFingerprint(
          userId,
          dto.sourceId,
          occurredAt,
          row.kind,
          row.amount,
          row.description,
        )

        const exists = await tx.transaction.findFirst({
          where: { userId, fingerprint: fp },
          select: { id: true },
        })
        if (exists) {
          skippedDuplicates++
          continue
        }

        let categoryId: string | null =
          row.categoryId ??
          this.categorizationRules.resolveCategoryId(
            row.kind,
            row.description,
            rules,
          ) ??
          null

        if (categoryId) {
          const cat = await tx.category.findFirst({
            where: { id: categoryId, userId },
          })
          if (!cat) {
            throw new BadRequestException('Invalid category')
          }
          const want: CategoryType =
            row.kind === TransactionKind.INCOME
              ? CategoryType.INCOME
              : CategoryType.EXPENSE
          if (cat.type !== want) {
            throw new BadRequestException(
              'Category type must match transaction kind',
            )
          }
        }

        await tx.transaction.create({
          data: {
            userId,
            sourceId: dto.sourceId,
            importBatchId: batch.id,
            kind: row.kind,
            amount: new Prisma.Decimal(row.amount.toFixed(2)),
            description: row.description.trim(),
            occurredAt,
            fingerprint: fp,
            categoryId,
          },
        })
        created++
      }

      return {
        importBatchId: batch.id,
        created,
        skippedDuplicates,
      }
    })

    return result
  }

  private async assertSourceOwned(userId: string, sourceId: string) {
    const s = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
    })
    if (!s) throw new BadRequestException('Invalid source')
  }
}
