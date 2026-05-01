import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import type { Recurrence, RecurrenceFrequency } from '@wimm/shared'
import { apiClient } from '../../lib/api-client'
import { dateFnsLocaleForLang, formatMediumDate } from '../../lib/dates'
import { formatMoney } from '../../lib/format-money'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

interface RecurrenceCardProps {
  recurrence: Recurrence
  categoryName?: string
  sourceName?: string
  onEdit: () => void
  onLongPress: () => void
}

export function RecurrenceCard({
  recurrence,
  categoryName,
  sourceName,
  onEdit,
  onLongPress,
}: RecurrenceCardProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const qc = useQueryClient()
  const isIncome = recurrence.kind === 'INCOME'

  const toggleMut = useMutation({
    mutationFn: async (active: boolean) => {
      await apiClient.patch(`/recurrences/${recurrence.id}`, { active })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const meta = [
    t(frequencyLabelKey(recurrence.frequency)),
    sourceName,
    categoryName,
  ].filter(Boolean) as string[]

  const endsLabel =
    recurrence.endMode === 'INDEFINITE'
      ? t('recurrences.endNever')
      : recurrence.endDate
        ? formatMediumDate(recurrence.endDate, dfLocale)
        : t('recurrences.endNever')

  return (
    <Pressable
      onPress={onEdit}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.card,
        !recurrence.active && styles.cardInactive,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.description} numberOfLines={1}>
            {recurrence.description}
          </Text>
          <Text
            style={[
              styles.amount,
              { color: isIncome ? colors.positive : colors.negative },
            ]}
          >
            {isIncome ? '+' : '−'}
            {formatMoney(recurrence.amount)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          {meta.map((m, i) => (
            <Text key={i} style={styles.metaItem} numberOfLines={1}>
              {i > 0 ? ' · ' : ''}
              {m}
            </Text>
          ))}
        </View>
        <View style={styles.footerRow}>
          <Text style={styles.footerLabel}>
            {t('recurrences.startDate')}:{' '}
            {formatMediumDate(recurrence.startDate, dfLocale)}
          </Text>
          <Text style={styles.footerLabel}>
            {t('recurrences.ends')}: {endsLabel}
          </Text>
        </View>
      </View>
      <Switch
        value={recurrence.active}
        onValueChange={(v) => toggleMut.mutate(v)}
        trackColor={{ false: colors.surface3, true: colors.accent }}
        thumbColor={colors.fg}
      />
    </Pressable>
  )
}

function frequencyLabelKey(f: RecurrenceFrequency): string {
  switch (f) {
    case 'WEEKLY':
      return 'recurrences.freqWeekly'
    case 'MONTHLY':
      return 'recurrences.freqMonthly'
    case 'YEARLY':
      return 'recurrences.freqYearly'
  }
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  cardInactive: {
    opacity: 0.55,
  },
  cardPressed: {
    backgroundColor: colors.surface2,
  },
  body: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  description: {
    flex: 1,
    color: colors.fg,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  amount: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  metaItem: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: 2,
    marginTop: 2,
  },
  footerLabel: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
})
