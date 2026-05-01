import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  Calendar,
  LocaleConfig,
  type DateData,
} from 'react-native-calendars'

interface PeriodMark {
  color: string
  textColor: string
  startingDay?: boolean
  endingDay?: boolean
}
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from './button'
import {
  dateFnsLocaleForLang,
  formatMediumDate,
  fromIsoDate,
  toIsoDate,
  type DateRange,
} from '../../lib/dates'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

LocaleConfig.locales.pt = {
  monthNames: [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ],
  monthNamesShort: [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ],
  dayNames: [
    'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
  ],
  dayNamesShort: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
}

interface DateRangeModalProps {
  visible: boolean
  onClose: () => void
  initial: DateRange
  onApply: (range: DateRange) => void
}

/**
 * Two-tap range picker on a single calendar.
 *  - Tap 1: sets start, clears end. Day highlights.
 *  - Tap 2: sets end (auto-swaps if before start). Range fills between.
 *  - Tap 3: starts a new range from that day.
 */
export function DateRangeModal({
  visible,
  onClose,
  initial,
  onApply,
}: DateRangeModalProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)

  // Hydrate from `initial` only when opening so subsequent re-renders don't
  // wipe the user's in-progress selection.
  useEffect(() => {
    if (visible) {
      setStart(initial.from)
      setEnd(initial.to)
    }
  }, [visible, initial.from, initial.to])

  const calendarLocale = i18n.language?.startsWith('pt') ? 'pt' : 'en'
  LocaleConfig.defaultLocale = calendarLocale

  const markedDates = useMemo<Record<string, PeriodMark>>(
    () => buildPeriodMarks(start, end),
    [start, end],
  )

  const handleDayPress = (day: DateData): void => {
    const iso = day.dateString
    if (!start || (start && end)) {
      // First tap or restarting after a complete range.
      setStart(iso)
      setEnd(null)
      return
    }
    // Second tap: set end (swap if user picked earlier than start).
    if (iso < start) {
      setEnd(start)
      setStart(iso)
    } else {
      setEnd(iso)
    }
  }

  const handleApply = (): void => {
    if (!start) return
    onApply({ from: start, to: end ?? start })
    onClose()
  }

  const startLabel = start
    ? formatMediumDate(fromIsoDate(start) ?? new Date(), dfLocale)
    : '—'
  const endLabel = end
    ? formatMediumDate(fromIsoDate(end) ?? new Date(), dfLocale)
    : start
      ? t('common.dateRange') // hint state
      : '—'

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('common.dateRange')}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </Pressable>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>{t('common.from')}</Text>
            <Text
              style={[
                styles.summaryValue,
                !start && styles.summaryValueMuted,
              ]}
            >
              {startLabel}
            </Text>
          </View>
          <Text style={styles.summarySep}>→</Text>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>{t('common.to')}</Text>
            <Text
              style={[
                styles.summaryValue,
                !end && styles.summaryValueMuted,
              ]}
            >
              {endLabel}
            </Text>
          </View>
        </View>

        <Calendar
          current={start ?? toIsoDate(new Date())}
          markingType="period"
          markedDates={markedDates}
          onDayPress={handleDayPress}
          enableSwipeMonths
          firstDay={Platform.OS === 'ios' ? 0 : 1}
          theme={calendarTheme}
          style={styles.calendar}
        />

        <View style={styles.footer}>
          <Button
            label={t('common.apply')}
            variant="primary"
            block
            disabled={!start || !end}
            onPress={handleApply}
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

function buildPeriodMarks(
  start: string | null,
  end: string | null,
): Record<string, PeriodMark> {
  if (!start) return {}
  const marks: Record<string, PeriodMark> = {}

  if (!end || end === start) {
    marks[start] = {
      startingDay: true,
      endingDay: true,
      color: colors.accent,
      textColor: colors.accentInk,
    }
    return marks
  }

  const cur = fromIsoDate(start)
  const stop = fromIsoDate(end)
  if (!cur || !stop) return marks

  while (cur <= stop) {
    const iso = toIsoDate(cur)
    const isStart = iso === start
    const isEnd = iso === end
    marks[iso] = {
      color: isStart || isEnd ? colors.accent : colors.accentSoft,
      textColor: isStart || isEnd ? colors.accentInk : colors.fg,
      startingDay: isStart,
      endingDay: isEnd,
    }
    cur.setDate(cur.getDate() + 1)
  }
  return marks
}

const calendarTheme = {
  backgroundColor: colors.bg,
  calendarBackground: colors.bg,
  textSectionTitleColor: colors.fgMuted,
  selectedDayBackgroundColor: colors.accent,
  selectedDayTextColor: colors.accentInk,
  todayTextColor: colors.accent,
  dayTextColor: colors.fg,
  textDisabledColor: colors.fgSoft,
  monthTextColor: colors.fg,
  arrowColor: colors.accent,
  textDayFontWeight: '500' as const,
  textMonthFontWeight: '600' as const,
  textDayHeaderFontWeight: '500' as const,
  textDayFontSize: fontSize.md,
  textMonthFontSize: fontSize.md,
  textDayHeaderFontSize: fontSize.xs,
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.lineSoft,
    borderBottomWidth: 1,
  },
  title: {
    color: colors.fg,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  close: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '500',
    letterSpacing: tracking.base,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryCol: {
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
    color: colors.fg,
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
  },
  summaryValueMuted: {
    color: colors.fgMuted,
  },
  summarySep: {
    color: colors.fgMuted,
    fontSize: fontSize.lg,
  },
  calendar: {
    backgroundColor: colors.bg,
    paddingVertical: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
  },
})
