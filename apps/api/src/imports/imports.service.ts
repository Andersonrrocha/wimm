import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import {
  AiCategorizationMode,
  CategoryType,
  ImportBatchFormat,
  type ImportParserWarning,
  SourceType,
  TransactionKind,
  toCents,
} from '@wimm/shared'
import { AiCategorizerSelector } from '../ai/ai-categorizer-selector.service'
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
import { detectImportFormat } from './import-format'
import {
  createGenericCsvMapperParser,
  getImportParser,
} from './import-parser-registry'
import {
  CsvSourceMappingService,
  InvalidStoredCsvMappingError,
} from './csv-source-mapping.service'
import { countGenericCsvColumns } from './parsers/generic-csv-mapper'
import type { ParsedLedgerRow } from './parsers/csv-parser'
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
    private readonly aiSelector: AiCategorizerSelector,
    private readonly csvSourceMappings: CsvSourceMappingService,
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
    const format = detected.format

    // A saved generic CSV mapping (Stage 2, Task 4) takes over CSV parsing
    // entirely -- the user already stated how to read this source's export,
    // so the header-name heuristic in `csv-parser.ts` never gets a turn.
    // `columnCountWarning` is populated up front (before parsing) so it is
    // never dependent on -- or lost among -- the per-row warnings the parse
    // itself may also produce.
    let parser = getImportParser(format)
    const preParseWarnings: ImportParserWarning[] = []
    if (format === ImportBatchFormat.CSV) {
      // `findForSource` validates the stored mapping on every read (Stage 2,
      // Task 4 fix round 1) and throws `InvalidStoredCsvMappingError` rather
      // than returning something unusable. A corrupted saved mapping is not
      // the user's fault and is not what they are asking about right now --
      // they picked a file to import -- so this is deliberately a warning
      // plus a fallback to automatic detection, not a failed request and not
      // a silent one. Failing the request would conflate "your saved column
      // mapping is broken" with "this import failed", the same conflation
      // this project has fixed repeatedly for parser warnings; falling back
      // *silently* would reintroduce exactly the silent-misparse risk this
      // whole mapping feature exists to close, since automatic detection can
      // produce a plausible-looking wrong number for the same file a
      // human-confirmed mapping was protecting against.
      let saved: Awaited<ReturnType<CsvSourceMappingService['findForSource']>>
      try {
        saved = await this.csvSourceMappings.findForSource(userId, sourceId)
      } catch (e) {
        if (e instanceof InvalidStoredCsvMappingError) {
          saved = null
          preParseWarnings.push({
            code: 'csv_mapping_invalid',
            message:
              `${e.message} Falling back to automatic column detection for this import -- ` +
              'check the preview rows carefully before importing, and re-map this source before your next import.',
            severity: 'warning',
          })
        } else {
          throw e
        }
      }
      if (saved) {
        const actualColumnCount = countGenericCsvColumns(
          file.buffer,
          saved.mapping,
        )
        if (actualColumnCount !== saved.columnCount) {
          preParseWarnings.push({
            code: 'csv_mapping_column_count_mismatch',
            message:
              `The saved column mapping for this source was confirmed against a file with ${saved.columnCount} column(s), ` +
              `but this file has ${actualColumnCount}. The saved mapping was still applied -- check the preview rows ` +
              'carefully before importing, and re-save the mapping if the columns have changed.',
            severity: 'warning',
          })
        }
        parser = createGenericCsvMapperParser(saved.mapping)
      }
    }

    const parseResult = parser.parse({
      buffer: file.buffer,
      ...('extractedText' in detected
        ? { extractedText: detected.extractedText }
        : {}),
    })
    const parsed: ParsedLedgerRow[] = parseResult.rows
    // Every registered parser reports warnings through the same shape (an
    // array, possibly empty), so the service no longer needs a per-format
    // branch to decide whether warnings apply.
    const parserWarnings: ImportParserWarning[] = [
      ...preParseWarnings,
      ...parseResult.warnings,
    ]
    const statementBillingPreview:
      | { paymentDueDate: string; statementClosingDate?: string }
      | undefined =
      previewSource.type === SourceType.CREDIT_CARD
        ? parseResult.statementBillingPreview
        : undefined

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
      parserWarnings,
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
              amountCents: toCents(row.amount),
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
              amountEachCents: toCents(row.amount),
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
            amountCents: toCents(row.amount),
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
                amountCents: toCents(row.amount),
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
   * Asks the AI provider to suggest a category for any preview row that the
   * deterministic rule pass missed. Mutates `rows` in place by setting
   * `aiSuggestedCategoryId` and `aiConfidence`.
   *
   * Returns early when the user's `aiCategorizationMode` is `OFF`, which is
   * the default. That check is deliberately *ahead* of the leaf-category
   * query below, for two reasons: that query is a real round trip carrying a
   * per-category aggregate, and it sits outside the try/catch that makes
   * provider failures advisory. Running it for someone who never enabled AI
   * would both spend a query on their behalf and let a failure in it reject
   * an import preview for a feature they did not ask for.
   *
   * Beyond that one gate, WHICH provider runs is `AiCategorizerSelector`'s
   * decision, taken from the user's mode and the credentials they actually
   * have -- an Anthropic key, a connected ChatGPT plan, or both. The chosen
   * provider is still handed only `userId` and resolves its own credential
   * for the call itself.
   *
   * Note what the OFF gate does *not* cover: a user who enabled AI but has
   * no usable credential still reaches the query below before selection
   * returns nothing. Selection could answer that earlier now that
   * `hasCredentialFor` exists, but moving it ahead of the query would put
   * another database read outside the try/catch that makes this block
   * advisory -- trading a spared query for a preview a selection failure
   * could reject. Left open deliberately, as before.
   *
   * Selection and provider errors alike are swallowed: AI is advisory, never
   * blocks the import preview.
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

    // AI categorization is opt-in and OFF by default. Gate on that here,
    // before spending anything on the user's behalf -- see this method's doc
    // comment for why this must precede the query below rather than being
    // left to the provider. The `TODO(paywall)` above anticipates this same
    // call site gating on the user's AI settings; this is the first half of
    // that check.
    let aiSettings: { aiCategorizationMode: string } | null
    try {
      aiSettings = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { aiCategorizationMode: true },
      })
    } catch (err) {
      // Swallowed deliberately, mirroring the credential lookup this gate
      // replaced: that one was wrapped exactly like this, so a database
      // error here stayed advisory instead of rejecting the preview. Losing
      // that would contradict the promise in this method's doc comment.
      this.logger.warn(
        `AI mode lookup failed for user ${userId}: ${(err as Error).message}`,
      )
      return
    }
    if (
      !aiSettings ||
      aiSettings.aiCategorizationMode === AiCategorizationMode.OFF
    ) {
      return
    }

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
      // Inside the try/catch on purpose: this reads the user row again, and
      // a selection failure must cost a suggestion, never the preview.
      const selection = await this.aiSelector.selectFor(userId)
      if (selection.needsChoice) {
        // Both own-credential sources are available and the user has chosen
        // neither. Guessing would spend one of their own credentials on a
        // decision they were never shown.
        //
        // `debug`, not `warn`: this is a legitimate steady state, not a
        // fault, and it fires on every preview the user runs. The level was
        // `warn` only while the state had no UI surface at all; the
        // Preferences tab now shows the chooser and the ChatGPT panel says
        // what is pending, so the user is told in the product. The line
        // stays because it is still the only server-side trace of the state.
        this.logger.debug(
          `AI categorize skipped for user ${userId}: both credential sources are available and none is selected.`,
        )
        return
      }
      if (!selection.provider) return

      const results = await selection.provider.categorizeBatch({
        userId,
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
