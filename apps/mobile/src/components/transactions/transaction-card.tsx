import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Transaction } from '@wimm/shared'
import { dateFnsLocaleForLang, formatShortDate } from '../../lib/dates'
import { formatTransactionDescriptionForDisplay } from '../../lib/format-transaction-description'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

interface TransactionCardProps {
  transaction: Transaction
  categoryName?: string
  sourceName?: string
  onPress?: () => void
  onLongPress?: () => void
}

function formatAmount(raw: string, kind: 'INCOME' | 'EXPENSE'): string {
  const n = Number.parseFloat(raw)
  if (Number.isNaN(n)) return raw
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return kind === 'INCOME' ? `+${formatted}` : `−${formatted}`
}

export function TransactionCard({
  transaction,
  categoryName,
  sourceName,
  onPress,
  onLongPress,
}: TransactionCardProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const isIncome = transaction.kind === 'INCOME'
  const description = formatTransactionDescriptionForDisplay(
    transaction.description,
    transaction.isProjected,
    t,
  )

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.pressed,
        transaction.isProjected && styles.projected,
      ]}
    >
      <View style={styles.body}>
        <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.metaItem} numberOfLines={1}>
            {categoryName ?? t('transactions.uncategorized')}
          </Text>
          {sourceName ? (
            <>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaItem} numberOfLines={1}>
                {sourceName}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.amountCol}>
        <Text
          style={[
            styles.amount,
            { color: isIncome ? colors.positive : colors.negative },
          ]}
        >
          {formatAmount(transaction.amount, transaction.kind)}
        </Text>
        <Text style={styles.date}>
          {formatShortDate(transaction.occurredAt, dfLocale)}
        </Text>
      </View>
    </Pressable>
  )
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
  pressed: {
    backgroundColor: colors.surface2,
  },
  projected: {
    opacity: 0.7,
    borderStyle: 'dashed',
  },
  body: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  description: {
    color: colors.fg,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaItem: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  metaSep: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
  },
  amountCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  date: {
    color: colors.fgSoft,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
})
