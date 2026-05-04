import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import {
  CategoryType,
  ImportBatchFormat,
  Prisma,
  SourceType,
  TransactionKind,
} from '@prisma/client'
import { AiKeyResolverService } from '../ai/ai-key-resolver.service'
import { AnthropicCategorizerService } from '../ai/anthropic-categorizer.service'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { CategorizationRulesService } from '../categorization-rules/categorization-rules.service'
import { PrismaService } from '../prisma/prisma.service'
import { computeImportFingerprint } from './fingerprint'
import { pickUniqueReconcilableCandidate } from './installment-reconcile.util'
import {
  buildProjectedInstallmentRows,
  type ImportStatementBillingBaseline,
} from './installment-projection.util'
import { billingFieldsFromStatementBilling } from './import-statement-billing.util'
import {
  detectImportFormat,
  isBanrisulPdfFormat,
  isCresolPdfFormat,
} from './import-format'
import { canParseBanrisulCreditCardPdf } from './parsers/banrisul-cc/banrisul-layout-guard'
import { canParseCresolStatementPdf } from './parsers/cresol/cresol-layout-guard'
import type { ParsedLedgerRow } from './parsers/csv-parser'
import { parseCsvBuffer } from './parsers/csv-parser'
import { parseOfxBuffer } from './parsers/ofx-parser'
import { banrisulStatementToLedgerRows } from './parsers/banrisul-cc/to-ledger-rows'
import { parseBanrisulStatementFromText } from './parsers/banrisul-cc/parse-statement-text'
import { mapBanrisulWarningsForPreview } from './map-banrisul-parser-warnings'
import { mapCresolWarningsForPreview } from './map-cresol-parser-warnings'
import { parseCresolStatementFromExtractedText } from './parsers/cresol/parse-cresol-statement-extracted-text'
import { cresolStatementToLedgerRows } from './parsers/cresol/to-ledger-rows'
import type { ImportParserWarning } from '@wimm/shared'
import type { CommitImportDto } from './dto/commit-import.dto'
import { sanitizePersistedInstallment } from './import-installment.util'
import {
  resolveTransactionBillingFields,
  TransactionBillingConfigError,
} from '../transactions/transaction-billing.util'

const MAX_IMPORT_ROWS = 10_000

type NormalizedLedgerRow = {
  occurredAt: Date
  kind: TransactionKind
  amountAbs: number
  description: string
  installmentCurrent?: number
  installmentTotal?: number
}

function toNormalized(row: ParsedLedgerRow): NormalizedLedgerRow {
  const signed = row.signedAmount
  const kind = signed >= 0 ? TransactionKind.INCOME : TransactionKind.EXPENSE
  const amountAbs = Math.abs(signed)
  if (amountAbs < 0.01) {
    throw new BadRequestException('Each row amount must be at least 0.01')
  }
  const base: NormalizedLedgerRow = {
    occurredAt: row.occurredAt,
    kind,
    amountAbs,
    description: row.description.slice(0, 512),
  }
  if (row.installmentCurrent != null && row.installmentTotal != null) {
    base.installmentCurrent = row.installmentCurrent
    base.installmentTotal = row.installmentTotal
  }
  return base
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly categorizationRules: CategorizationRulesService,
    private readonly defaultCategories: DefaultCategoriesService,
    private readonly aiKeyResolver: AiKeyResolverService,
    private readonly aiCategorizer: AnthropicCategorizerService,
  ) {}

  async preview(
    userId: string,
    sourceId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required')
    }

    const previewSource = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
      select: { type: true },
    })
    if (!previewSource) {
      throw new BadRequestException('Invalid source')
    }

    const detected = await detectImportFormat(file.originalname, file.buffer)
    let format: ImportBatchFormat
    let parsed: ParsedLedgerRow[]
    /** Set for bank-specific PDF formats (always, including empty array). */
    let parserWarnings: ImportParserWarning[] | undefined
    let statementBillingPreview:
      | { paymentDueDate: string; statementClosingDate?: string }
      | undefined

    if (detected.format === ImportBatchFormat.CSV) {
      format = ImportBatchFormat.CSV
      parsed = parseCsvBuffer(file.buffer)
    } else if (detected.format === ImportBatchFormat.OFX) {
      format = ImportBatchFormat.OFX
      parsed = parseOfxBuffer(file.buffer)
    } else if (isBanrisulPdfFormat(detected)) {
      format = ImportBatchFormat.PDF_BANRISUL_CC
      const layout = canParseBanrisulCreditCardPdf(detected.extractedText)
      if (!layout.ok) {
        throw new BadRequestException(layout.message)
      }
      let banrisul
      try {
        banrisul = parseBanrisulStatementFromText(detected.extractedText)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new BadRequestException(
          `Could not parse this Banrisul credit card statement PDF: ${msg}`,
        )
      }
      parserWarnings = mapBanrisulWarningsForPreview(banrisul.warnings)
      parsed = banrisulStatementToLedgerRows(banrisul)
      if (
        previewSource.type === SourceType.CREDIT_CARD &&
        banrisul.statementBilling
      ) {
        const b = banrisul.statementBilling
        statementBillingPreview = {
          paymentDueDate: b.paymentDueDate.toISOString().slice(0, 10),
          ...(b.statementClosingDate !== undefined
            ? {
                statementClosingDate: b.statementClosingDate
                  .toISOString()
                  .slice(0, 10),
              }
            : {}),
        }
      }
    } else if (isCresolPdfFormat(detected)) {
      format = ImportBatchFormat.PDF_CRESOL_STATEMENT
      const layout = canParseCresolStatementPdf(detected.extractedText)
      if (!layout.ok) {
        throw new BadRequestException(layout.message)
      }
      const cresol = parseCresolStatementFromExtractedText(detected.extractedText)
      parserWarnings = mapCresolWarningsForPreview(cresol.warnings)
      parsed = cresolStatementToLedgerRows(cresol)
    } else {
      throw new BadRequestException('Unsupported import format')
    }

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

    await this.defaultCategories.ensureForUser(userId)

    const rules =
      await this.categorizationRules.loadActiveRulesWithCategories(userId)
    const systemCtx =
      await this.categorizationRules.loadSystemResolutionContext(userId)

    const rows: Array<{
      occurredAt: string
      kind: TransactionKind
      amount: string
      description: string
      fingerprint: string
      isDuplicate: boolean
      suggestedCategoryId: string | null
      aiSuggestedCategoryId?: string | null
      aiConfidence?: number
      installmentCurrent?: number
      installmentTotal?: number
    }> = normalized.map((n, i) => {
      const fingerprint = fingerprints[i]
      const isDuplicate = dupSet.has(fingerprint)
      const suggestedCategoryId =
        this.categorizationRules.resolveCategoryIdWithSystem(
          n.kind,
          n.description,
          rules,
          systemCtx,
        ) ?? null
      return {
        occurredAt: n.occurredAt.toISOString(),
        kind: n.kind,
        amount: n.amountAbs.toFixed(2),
        description: n.description,
        fingerprint,
        isDuplicate,
        suggestedCategoryId,
        ...(n.installmentCurrent != null && n.installmentTotal != null
          ? {
              installmentCurrent: n.installmentCurrent,
              installmentTotal: n.installmentTotal,
            }
          : {}),
      }
    })

    await this.enrichWithAiSuggestions(userId, rows)

    const duplicateCount = rows.filter((r) => r.isDuplicate).length
    const newCount = rows.length - duplicateCount

    return {
      format,
      fileName: file.originalname,
      rows,
      totalParsed: rows.length,
      duplicateCount,
      newCount,
      ...(statementBillingPreview !== undefined
        ? { statementBilling: statementBillingPreview }
        : {}),
      // Warnings are preview-only; ImportBatch does not persist them yet.
      ...(parserWarnings !== undefined ? { parserWarnings } : {}),
    }
  }

  async commit(userId: string, dto: CommitImportDto) {
    await this.assertSourceOwned(userId, dto.sourceId)

    await this.defaultCategories.ensureForUser(userId)

    const rules =
      await this.categorizationRules.loadActiveRulesWithCategories(userId)
    const systemCtx =
      await this.categorizationRules.loadSystemResolutionContext(userId)

    const result = await this.prisma.$transaction(async (tx) => {
      const sourceRow = await tx.source.findFirst({
        where: { id: dto.sourceId, userId },
        select: { type: true, closingDay: true, dueDay: true },
      })
      if (!sourceRow) {
        throw new BadRequestException('Invalid source')
      }

      let batchBillingFromStatement: {
        billingCycleMonth: number
        billingCycleYear: number
        expectedDueDate: Date
      } | null = null
      let importStatementBaseline: ImportStatementBillingBaseline | null = null

      if (
        sourceRow.type === SourceType.CREDIT_CARD &&
        dto.statementBilling?.paymentDueDate
      ) {
        const paymentDue = new Date(dto.statementBilling.paymentDueDate)
        if (Number.isNaN(paymentDue.getTime())) {
          throw new BadRequestException(
            'Invalid statement billing payment due date',
          )
        }
        let statementClosing: Date | undefined
        if (dto.statementBilling.statementClosingDate) {
          statementClosing = new Date(dto.statementBilling.statementClosingDate)
          if (Number.isNaN(statementClosing.getTime())) {
            throw new BadRequestException(
              'Invalid statement billing closing date',
            )
          }
        }
        batchBillingFromStatement = billingFieldsFromStatementBilling({
          paymentDueDate: paymentDue,
          statementClosingDate: statementClosing,
        })
        importStatementBaseline = {
          dueDate: batchBillingFromStatement.expectedDueDate,
          ...(statementClosing !== undefined
            ? {
                closingDate: new Date(
                  Date.UTC(
                    statementClosing.getUTCFullYear(),
                    statementClosing.getUTCMonth(),
                    statementClosing.getUTCDate(),
                    12,
                    0,
                    0,
                  ),
                ),
              }
            : {}),
        }
      }

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
          this.categorizationRules.resolveCategoryIdWithSystem(
            row.kind,
            row.description,
            rules,
            systemCtx,
          ) ??
          (row.kind === TransactionKind.EXPENSE
            ? (systemCtx.categoryIdByKey?.get('other') ?? null)
            : null)

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

        let billing: {
          billingCycleMonth: number | null
          billingCycleYear: number | null
          expectedDueDate: Date | null
        }
        if (batchBillingFromStatement !== null) {
          billing = {
            billingCycleMonth: batchBillingFromStatement.billingCycleMonth,
            billingCycleYear: batchBillingFromStatement.billingCycleYear,
            expectedDueDate: batchBillingFromStatement.expectedDueDate,
          }
        } else {
          try {
            billing = resolveTransactionBillingFields(sourceRow, occurredAt)
          } catch (e) {
            if (e instanceof TransactionBillingConfigError) {
              throw new BadRequestException(e.message)
            }
            throw e
          }
        }

        const installment =
          sourceRow.type === SourceType.CREDIT_CARD
            ? sanitizePersistedInstallment(
                row.installmentCurrent,
                row.installmentTotal,
              )
            : null

        if (
          installment &&
          sourceRow.type === SourceType.CREDIT_CARD &&
          billing.billingCycleMonth != null &&
          billing.billingCycleYear != null
        ) {
          const candidates = await tx.transaction.findMany({
            where: {
              userId,
              sourceId: dto.sourceId,
              isProjected: true,
              kind: row.kind,
              installmentCurrent: installment.installmentCurrent,
              installmentTotal: installment.installmentTotal,
              billingCycleMonth: billing.billingCycleMonth,
              billingCycleYear: billing.billingCycleYear,
              amount: new Prisma.Decimal(row.amount.toFixed(2)),
            },
            select: { id: true, description: true },
          })

          const reconcileId = pickUniqueReconcilableCandidate(
            candidates,
            row.description,
          )

          if (reconcileId) {
            await tx.transaction.update({
              where: { id: reconcileId },
              data: {
                isProjected: false,
                isConfirmedFromImport: true,
                importBatchId: batch.id,
                occurredAt,
                description: row.description.trim(),
                fingerprint: fp,
                categoryId,
                billingCycleMonth: billing.billingCycleMonth,
                billingCycleYear: billing.billingCycleYear,
                expectedDueDate: billing.expectedDueDate,
              },
            })
            created++
            continue
          }
        }

        let installmentPlanId: string | null = null
        if (installment) {
          const plan = await tx.installmentPlan.create({
            data: {
              userId,
              sourceId: dto.sourceId,
              originatingBatchId: batch.id,
              installmentTotal: installment.installmentTotal,
              amountEach: new Prisma.Decimal(row.amount.toFixed(2)),
            },
          })
          installmentPlanId = plan.id
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
            billingCycleMonth: billing.billingCycleMonth,
            billingCycleYear: billing.billingCycleYear,
            expectedDueDate: billing.expectedDueDate,
            installmentCurrent: installment?.installmentCurrent ?? null,
            installmentTotal: installment?.installmentTotal ?? null,
            installmentPlanId,
            isProjected: false,
            isConfirmedFromImport: true,
          },
        })
        created++

        if (
          installment &&
          installment.installmentCurrent < installment.installmentTotal
        ) {
          const projectedRows = buildProjectedInstallmentRows({
            userId,
            installmentPlanId: installmentPlanId!,
            sourceBilling: sourceRow,
            baseDescription: row.description.trim(),
            baseOccurredAt: occurredAt,
            importedCurrent: installment.installmentCurrent,
            installmentTotal: installment.installmentTotal,
            amount: row.amount,
            kind: row.kind,
            ...(importStatementBaseline !== null
              ? { importStatementBaseline }
              : {}),
          })

          for (const p of projectedRows) {
            const projExists = await tx.transaction.findFirst({
              where: { userId, fingerprint: p.fingerprint },
              select: { id: true },
            })
            if (projExists) continue

            await tx.transaction.create({
              data: {
                userId,
                sourceId: dto.sourceId,
                importBatchId: null,
                installmentPlanId,
                kind: row.kind,
                amount: new Prisma.Decimal(row.amount.toFixed(2)),
                description: p.description,
                occurredAt: p.occurredAt,
                fingerprint: p.fingerprint,
                categoryId,
                billingCycleMonth: p.billing.billingCycleMonth,
                billingCycleYear: p.billing.billingCycleYear,
                expectedDueDate: p.billing.expectedDueDate,
                installmentCurrent: p.installmentCurrent,
                installmentTotal: installment.installmentTotal,
                isProjected: true,
                isConfirmedFromImport: false,
              },
            })
            created++
          }
        }
      }

      return {
        importBatchId: batch.id,
        created,
        skippedDuplicates,
      }
    })

    return result
  }

  /**
   * If the user has AI categorization enabled, asks Claude to suggest a
   * category for any preview row that the deterministic rule pass missed.
   * Mutates `rows` in place by setting `aiSuggestedCategoryId` and
   * `aiConfidence`. All errors are swallowed: AI is advisory, never blocks
   * the import preview.
   */
  private async enrichWithAiSuggestions(
    userId: string,
    rows: Array<{
      kind: TransactionKind
      amount: string
      description: string
      isDuplicate: boolean
      suggestedCategoryId: string | null
      aiSuggestedCategoryId?: string | null
      aiConfidence?: number
    }>,
  ): Promise<void> {
    // TODO(paywall): only call AI when subscriptionStatus === 'ACTIVE'
    // and (mode === 'BYOK' || plan in MONTHLY|ANNUAL|LIFETIME).
    const candidateIndexes: number[] = []
    rows.forEach((r, i) => {
      if (!r.isDuplicate && r.suggestedCategoryId === null) {
        candidateIndexes.push(i)
      }
    })
    if (candidateIndexes.length === 0) return

    let apiKey: string | null
    try {
      apiKey = await this.aiKeyResolver.resolveForUser(userId)
    } catch (err) {
      this.logger.warn(`AI key resolver failed: ${(err as Error).message}`)
      return
    }
    if (!apiKey) return

    // Only suggest leaf categories (no children) — same constraint the
    // categorization-rules service applies, so AI matches feel native.
    const leafCategories = await this.prisma.category.findMany({
      where: { userId, categoryKey: { not: null } },
      select: { id: true, name: true, _count: { select: { children: true } } },
    })
    const candidates = leafCategories
      .filter((c) => c._count.children === 0)
      .map((c) => ({ id: c.id, name: c.name }))
    if (candidates.length === 0) return

    const inputs = candidateIndexes.map((idx) => ({
      index: idx,
      description: rows[idx]!.description,
      amount: rows[idx]!.amount,
    }))

    try {
      const results = await this.aiCategorizer.categorizeBatch({
        apiKey,
        transactions: inputs,
        candidates,
      })
      for (const r of results) {
        const row = rows[r.index]
        if (!row) continue
        row.aiSuggestedCategoryId = r.categoryId
        row.aiConfidence = r.confidence
      }
    } catch (err) {
      this.logger.warn(
        `AI categorize failed for user ${userId}: ${(err as Error).message}`,
      )
    }
  }

  private async assertSourceOwned(userId: string, sourceId: string) {
    const s = await this.prisma.source.findFirst({
      where: { id: sourceId, userId },
    })
    if (!s) throw new BadRequestException('Invalid source')
  }
}
