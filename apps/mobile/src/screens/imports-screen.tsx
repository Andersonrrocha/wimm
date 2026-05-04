import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import type {
  CategorizationRule,
  Category,
  CommitImportRequest,
  CommitImportResponse,
  ImportParserWarning,
  ImportPreviewResponse,
  ImportPreviewRow,
  Source,
} from '@wimm/shared'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty-state'
import { Field } from '../components/ui/field'
import { PageHeader } from '../components/ui/page-header'
import { Panel } from '../components/ui/panel'
import { PickerModal, type PickerOption } from '../components/ui/picker-modal'
import {
  SaveAsRuleSheet,
  suggestPatternFromDescription,
} from '../components/save-as-rule-sheet'
import { Screen } from '../components/screen'
import { apiClient } from '../lib/api-client'
import { dateFnsLocaleForLang, formatMediumDate } from '../lib/dates'
import { formatMoney } from '../lib/format-money'
import { colors, fontSize, radius, spacing, tracking } from '../theme/tokens'

const MAX_FILE_SIZE = 5 * 1024 * 1024

type WizardStep = 'pick' | 'preview' | 'result'

interface PickedFile {
  uri: string
  name: string
  mimeType: string
  size: number
}

export function ImportsScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [step, setStep] = useState<WizardStep>('pick')
  const [sourceId, setSourceId] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [includeByFp, setIncludeByFp] = useState<Record<string, boolean>>({})
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(
    null,
  )

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })

  const sourceOptions: PickerOption[] = useMemo(
    () => sources.map((s) => ({ value: s.id, label: s.name })),
    [sources],
  )
  const sourceLabel = sourceId
    ? sources.find((s) => s.id === sourceId)?.name ?? ''
    : ''

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!file || !sourceId) throw new Error('Missing file or source')
      const fd = new FormData()
      // RN FormData accepts the {uri, name, type} shape for file entries.
      fd.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as unknown as Blob)
      fd.append('sourceId', sourceId)
      const { data } = await apiClient.post<ImportPreviewResponse>(
        '/imports/preview',
        fd,
      )
      return data
    },
    onSuccess: (data) => {
      setPreview(data)
      // Default: include only non-duplicates.
      const initial: Record<string, boolean> = {}
      for (const row of data.rows) {
        initial[row.fingerprint] = !row.isDuplicate
      }
      setIncludeByFp(initial)
      setStep('preview')
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })
  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const [saveRuleTarget, setSaveRuleTarget] = useState<{
    pattern: string
    categoryId: string
    categoryName: string
  } | null>(null)

  const saveRuleMut = useMutation({
    mutationFn: async (body: { pattern: string; categoryId: string }) => {
      const { data } = await apiClient.post<CategorizationRule>(
        '/categorization-rules',
        {
          pattern: body.pattern,
          categoryId: body.categoryId,
          matchType: 'CONTAINS',
          priority: 100,
          active: true,
        },
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rules'] })
    },
  })

  const commitMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('No preview')
      const rows = preview.rows
        .filter((r) => includeByFp[r.fingerprint])
        .map((r) => {
          // Prefer the rule match; fall back to AI when no rule fired.
          const categoryId = r.suggestedCategoryId ?? r.aiSuggestedCategoryId
          return {
            occurredAt: r.occurredAt,
            kind: r.kind,
            amount: Number.parseFloat(r.amount),
            description: r.description,
            ...(categoryId ? { categoryId } : {}),
            ...(r.installmentCurrent !== undefined
              ? { installmentCurrent: r.installmentCurrent }
              : {}),
            ...(r.installmentTotal !== undefined
              ? { installmentTotal: r.installmentTotal }
              : {}),
          }
        })
      const body: CommitImportRequest = {
        sourceId,
        fileName: preview.fileName,
        format: preview.format,
        rows,
        ...(preview.statementBilling
          ? { statementBilling: preview.statementBilling }
          : {}),
      }
      const { data } = await apiClient.post<CommitImportResponse>(
        '/imports/commit',
        body,
      )
      return data
    },
    onSuccess: async (data) => {
      setCommitResult(data)
      setStep('result')
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const handlePickFile = async (): Promise<void> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'application/pdf',
        'application/x-ofx',
        'application/octet-stream',
        '*/*',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    if (asset.size && asset.size > MAX_FILE_SIZE) {
      Alert.alert(
        t('imports.fileTooLargeTitle'),
        t('imports.fileTooLargeMessage', {
          max: Math.round(MAX_FILE_SIZE / 1024 / 1024),
        }),
      )
      return
    }
    setFile({
      uri: asset.uri,
      name: asset.name ?? 'upload',
      mimeType: asset.mimeType ?? 'application/octet-stream',
      size: asset.size ?? 0,
    })
  }

  const reset = (): void => {
    setStep('pick')
    setFile(null)
    setPreview(null)
    setIncludeByFp({})
    setCommitResult(null)
    previewMut.reset()
    commitMut.reset()
  }

  const includedCount = useMemo(
    () => Object.values(includeByFp).filter(Boolean).length,
    [includeByFp],
  )

  return (
    <Screen scroll>
      <PageHeader
        eyebrow={t('imports.eyebrow')}
        title={t('nav.imports')}
        subtitle={step === 'pick' ? t('imports.statementSubtitle') : undefined}
      />

      <StepIndicator current={step} />

      {step === 'pick' ? (
        <PickStep
          sources={sources}
          sourceId={sourceId}
          sourceLabel={sourceLabel}
          file={file}
          onOpenSourcePicker={() => setShowSourcePicker(true)}
          onPickFile={handlePickFile}
          onSubmit={() => previewMut.mutate()}
          loading={previewMut.isPending}
          error={previewMut.isError}
        />
      ) : step === 'preview' && preview ? (
        <PreviewStep
          preview={preview}
          includeByFp={includeByFp}
          onToggle={(fp, value) =>
            setIncludeByFp((prev) => ({ ...prev, [fp]: value }))
          }
          includedCount={includedCount}
          onBack={reset}
          onCommit={() => commitMut.mutate()}
          committing={commitMut.isPending}
          error={commitMut.isError}
          onSaveRule={(row, categoryId) => {
            setSaveRuleTarget({
              pattern: suggestPatternFromDescription(row.description),
              categoryId,
              categoryName:
                categoryNameById.get(categoryId) ??
                t('transactions.uncategorized'),
            })
          }}
        />
      ) : step === 'result' && commitResult ? (
        <ResultStep result={commitResult} onDone={reset} />
      ) : null}

      <PickerModal
        visible={showSourcePicker}
        onClose={() => setShowSourcePicker(false)}
        title={t('imports.source')}
        options={sourceOptions}
        selected={sourceId}
        onSelect={setSourceId}
      />

      <SaveAsRuleSheet
        visible={saveRuleTarget !== null}
        onClose={() => setSaveRuleTarget(null)}
        defaultPattern={saveRuleTarget?.pattern ?? ''}
        categoryName={saveRuleTarget?.categoryName ?? ''}
        saving={saveRuleMut.isPending}
        onSave={async (pattern) => {
          if (!saveRuleTarget) return
          await saveRuleMut.mutateAsync({
            pattern,
            categoryId: saveRuleTarget.categoryId,
          })
        }}
      />
    </Screen>
  )
}

function StepIndicator({ current }: { current: WizardStep }): JSX.Element {
  const { t } = useTranslation()
  const steps: { id: WizardStep; labelKey: string }[] = [
    { id: 'pick', labelKey: 'imports.stepPick' },
    { id: 'preview', labelKey: 'imports.stepPreview' },
    { id: 'result', labelKey: 'imports.stepResult' },
  ]
  return (
    <View style={styles.steps}>
      {steps.map((s, i) => {
        const active = s.id === current
        const done =
          (current === 'preview' && s.id === 'pick') ||
          (current === 'result' &&
            (s.id === 'pick' || s.id === 'preview'))
        return (
          <View key={s.id} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                active && styles.stepDotActive,
                done && styles.stepDotDone,
              ]}
            >
              <Text
                style={[
                  styles.stepDotLabel,
                  (active || done) && styles.stepDotLabelActive,
                ]}
              >
                {i + 1}
              </Text>
            </View>
            <Text
              style={[styles.stepLabel, active && styles.stepLabelActive]}
            >
              {t(s.labelKey)}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function PickStep({
  sources,
  sourceId,
  sourceLabel,
  file,
  onOpenSourcePicker,
  onPickFile,
  onSubmit,
  loading,
  error,
}: {
  sources: Source[]
  sourceId: string
  sourceLabel: string
  file: PickedFile | null
  onOpenSourcePicker: () => void
  onPickFile: () => Promise<void>
  onSubmit: () => void
  loading: boolean
  error: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const ready = sourceId !== '' && file !== null

  return (
    <View style={styles.pickSection}>
      <Field label={t('imports.source')}>
        <Pressable
          onPress={onOpenSourcePicker}
          disabled={sources.length === 0}
          style={({ pressed }) => [
            styles.fieldButton,
            pressed && styles.fieldPressed,
            sources.length === 0 && styles.fieldDisabled,
          ]}
        >
          <Text style={styles.fieldValue}>
            {sources.length === 0
              ? t('imports.needSource')
              : sourceLabel || t('imports.selectSource')}
          </Text>
        </Pressable>
      </Field>

      <Field
        label={t('imports.fileLabel')}
        hint={t('imports.fileSizeHint', { max: 5 })}
      >
        <Pressable
          onPress={onPickFile}
          style={({ pressed }) => [
            styles.fieldButton,
            pressed && styles.fieldPressed,
          ]}
        >
          <Text style={styles.fieldValue} numberOfLines={1}>
            {file ? file.name : t('imports.chooseFile')}
          </Text>
          {file ? (
            <Text style={styles.fieldSub}>
              {formatBytes(file.size)} · {file.mimeType}
            </Text>
          ) : null}
        </Pressable>
      </Field>

      <Button
        label={loading ? t('imports.parsing') : t('imports.preview')}
        variant="primary"
        block
        loading={loading}
        disabled={!ready || loading}
        onPress={onSubmit}
      />

      {error ? (
        <Text style={styles.error}>{t('imports.previewFailed')}</Text>
      ) : null}
    </View>
  )
}

function PreviewStep({
  preview,
  includeByFp,
  onToggle,
  includedCount,
  onBack,
  onCommit,
  committing,
  error,
  onSaveRule,
}: {
  preview: ImportPreviewResponse
  includeByFp: Record<string, boolean>
  onToggle: (fp: string, value: boolean) => void
  includedCount: number
  onBack: () => void
  onCommit: () => void
  committing: boolean
  error: boolean
  onSaveRule: (row: ImportPreviewRow, categoryId: string) => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)

  return (
    <View style={styles.previewSection}>
      <Panel padding="sm">
        <View style={styles.summaryRow}>
          <SummaryStat
            label={t('imports.statParsed')}
            value={String(preview.totalParsed)}
          />
          <SummaryStat
            label={t('imports.statNew')}
            value={String(preview.newCount)}
            tone="positive"
          />
          <SummaryStat
            label={t('imports.statDuplicates')}
            value={String(preview.duplicateCount)}
            tone="muted"
          />
        </View>
        <Text style={styles.fileName}>{preview.fileName}</Text>
        <Chip label={preview.format} tone="neutral" />
      </Panel>

      {preview.parserWarnings && preview.parserWarnings.length > 0 ? (
        <View style={styles.warnings}>
          {preview.parserWarnings.map((w, i) => (
            <ParserWarningBanner key={`${w.code}-${i}`} warning={w} />
          ))}
        </View>
      ) : null}

      <FlatList
        data={preview.rows}
        keyExtractor={(r) => r.fingerprint}
        scrollEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.rowSep} />}
        renderItem={({ item }) => (
          <PreviewRowCard
            row={item}
            included={includeByFp[item.fingerprint] ?? false}
            onToggle={(v) => onToggle(item.fingerprint, v)}
            dfLocale={dfLocale}
            onSaveRule={onSaveRule}
          />
        )}
      />

      <View style={styles.previewFooter}>
        <Text style={styles.muted}>
          {t('imports.selectedOf', {
            selected: includedCount,
            total: preview.rows.length,
          })}
        </Text>
        <View style={styles.previewActions}>
          <Button
            label={t('common.cancel')}
            variant="subtle"
            onPress={onBack}
            disabled={committing}
          />
          <Button
            label={
              committing
                ? t('common.pleaseWait')
                : t('imports.importCount', { count: includedCount })
            }
            variant="primary"
            loading={committing}
            disabled={committing || includedCount === 0}
            onPress={onCommit}
          />
        </View>
        {error ? (
          <Text style={styles.error}>{t('imports.commitError')}</Text>
        ) : null}
      </View>
    </View>
  )
}

function PreviewRowCard({
  row,
  included,
  onToggle,
  dfLocale,
  onSaveRule,
}: {
  row: ImportPreviewRow
  included: boolean
  onToggle: (v: boolean) => void
  dfLocale: ReturnType<typeof dateFnsLocaleForLang>
  onSaveRule: (row: ImportPreviewRow, categoryId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const isIncome = row.kind === 'INCOME'
  const amount = formatMoney(row.amount)
  const aiPct = Math.round((row.aiConfidence ?? 0) * 100)
  const showAi =
    !row.isDuplicate &&
    !row.suggestedCategoryId &&
    row.aiSuggestedCategoryId != null
  return (
    <Pressable
      onPress={() => onToggle(!included)}
      style={({ pressed }) => [
        styles.previewRow,
        !included && styles.previewRowExcluded,
        pressed && styles.previewRowPressed,
      ]}
    >
      <Switch
        value={included}
        onValueChange={onToggle}
        trackColor={{ false: colors.surface3, true: colors.accent }}
        thumbColor={colors.fg}
      />
      <View style={styles.previewBody}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewDescription} numberOfLines={1}>
            {row.description}
          </Text>
          <Text
            style={[
              styles.previewAmount,
              { color: isIncome ? colors.positive : colors.negative },
            ]}
          >
            {isIncome ? '+' : '−'}
            {amount}
          </Text>
        </View>
        <View style={styles.previewMeta}>
          <Text style={styles.previewDate}>
            {formatMediumDate(row.occurredAt, dfLocale)}
          </Text>
          {row.installmentTotal && row.installmentCurrent ? (
            <>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.previewMetaItem}>
                {row.installmentCurrent}/{row.installmentTotal}
              </Text>
            </>
          ) : null}
          {row.isDuplicate ? <Chip label="dupe" tone="warning" /> : null}
          {showAi ? (
            <Chip
              label={t('imports.matchAi', { confidence: aiPct })}
              tone="info"
            />
          ) : null}
          {showAi ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation()
                onSaveRule(row, row.aiSuggestedCategoryId!)
              }}
              hitSlop={8}
            >
              <Text style={styles.saveRuleLink}>
                {t('imports.saveAsRule')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

function ParserWarningBanner({
  warning,
}: {
  warning: ImportParserWarning
}): JSX.Element {
  const isInfo = warning.severity === 'info'
  return (
    <View
      style={[
        styles.warningBanner,
        isInfo ? styles.warningInfo : styles.warningWarn,
      ]}
    >
      <Text
        style={[
          styles.warningCode,
          isInfo ? styles.warningCodeInfo : styles.warningCodeWarn,
        ]}
      >
        {warning.code}
      </Text>
      <Text style={styles.warningMessage}>{warning.message}</Text>
      {warning.rawLine ? (
        <Text style={styles.warningRaw} numberOfLines={2}>
          {warning.rawLine}
        </Text>
      ) : null}
    </View>
  )
}

function ResultStep({
  result,
  onDone,
}: {
  result: CommitImportResponse
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Panel>
      <EmptyState
        title={t('imports.resultTitle')}
        subtitle={t('imports.commitSuccess', {
          created: result.created,
          skipped: result.skippedDuplicates,
        })}
        action={
          <Button
            label={t('imports.importAnother')}
            variant="primary"
            onPress={onDone}
          />
        }
      />
    </Panel>
  )
}

function SummaryStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'muted'
}): JSX.Element {
  const color =
    tone === 'positive'
      ? colors.positive
      : tone === 'muted'
        ? colors.fgMuted
        : colors.fg
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const styles = StyleSheet.create({
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stepDotDone: {
    backgroundColor: colors.positiveSoft,
    borderColor: colors.positive,
  },
  stepDotLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  stepDotLabelActive: {
    color: colors.fg,
  },
  stepLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  },
  stepLabelActive: {
    color: colors.fg,
  },
  pickSection: {
    gap: spacing.md,
  },
  fieldButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  fieldPressed: {
    backgroundColor: colors.surface3,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldValue: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  fieldSub: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  previewSection: {
    gap: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryStat: {
    flex: 1,
    gap: 2,
  },
  summaryLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fileName: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  warnings: {
    gap: 6,
  },
  warningBanner: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
    borderWidth: 1,
  },
  warningInfo: {
    backgroundColor: colors.infoSoft,
    borderColor: 'rgba(138, 180, 248, 0.35)',
  },
  warningWarn: {
    backgroundColor: colors.warningSoft,
    borderColor: 'rgba(255, 198, 109, 0.35)',
  },
  warningCode: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  },
  warningCodeInfo: {
    color: colors.info,
  },
  warningCodeWarn: {
    color: colors.warning,
  },
  warningMessage: {
    color: colors.fg,
    fontSize: fontSize.sm,
  },
  warningRaw: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontFamily: 'Menlo',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderColor: colors.lineSoft,
    borderWidth: 1,
  },
  previewRowExcluded: {
    opacity: 0.45,
  },
  previewRowPressed: {
    backgroundColor: colors.surface2,
  },
  previewBody: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  previewDescription: {
    flex: 1,
    color: colors.fg,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  previewAmount: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  previewDate: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  previewMetaItem: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  metaSep: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
  },
  saveRuleLink: {
    color: colors.accent,
    fontSize: fontSize.xs,
    textDecorationLine: 'underline',
  },
  rowSep: {
    height: 6,
  },
  previewFooter: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  previewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  muted: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
})
