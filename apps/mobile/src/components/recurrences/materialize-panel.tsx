import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { MaterializeRequest, MaterializeResponse } from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Panel } from '../ui/panel'
import { apiClient } from '../../lib/api-client'
import {
  dateFnsLocaleForLang,
  formatMediumDate,
  toIsoDate,
} from '../../lib/dates'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

export function MaterializePanel(): JSX.Element {
  const { t, i18n } = useTranslation()
  const dfLocale = dateFnsLocaleForLang(i18n.language)
  const qc = useQueryClient()
  const [until, setUntil] = useState<Date>(() => defaultUntil())
  const [showPicker, setShowPicker] = useState(false)

  const mut = useMutation({
    mutationFn: async () => {
      const body: MaterializeRequest = { until: toIsoDate(until) }
      const { data } = await apiClient.post<MaterializeResponse>(
        '/recurrences/materialize',
        body,
      )
      return data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      await qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const onDateChange = (
    _: DateTimePickerEvent,
    selected: Date | undefined,
  ): void => {
    if (Platform.OS !== 'ios') setShowPicker(false)
    if (selected) setUntil(selected)
  }

  return (
    <Panel padding="md">
      <Text style={styles.title}>{t('recurrences.generateTitle')}</Text>
      <Text style={styles.subtitle}>
        {t('recurrences.generateSubtitle')}
      </Text>

      <View style={styles.row}>
        <Field label={t('recurrences.until')} style={styles.flex1}>
          <Pressable
            onPress={() => setShowPicker(true)}
            style={({ pressed }) => [
              styles.fieldButton,
              pressed && styles.fieldPressed,
            ]}
          >
            <Text style={styles.fieldValue}>
              {formatMediumDate(until, dfLocale)}
            </Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker
              value={until}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onDateChange}
              themeVariant="dark"
            />
          )}
          {Platform.OS === 'ios' && showPicker ? (
            <Pressable
              onPress={() => setShowPicker(false)}
              style={styles.dismiss}
            >
              <Text style={styles.dismissLabel}>{t('common.close')}</Text>
            </Pressable>
          ) : null}
        </Field>
        <Button
          label={mut.isPending ? t('recurrences.generating') : t('recurrences.generate')}
          variant="primary"
          loading={mut.isPending}
          disabled={mut.isPending}
          onPress={() => mut.mutate()}
        />
      </View>

      {mut.isSuccess ? (
        <Text style={styles.success}>
          {t('recurrences.materializeSuccess', {
            count: mut.data?.created ?? 0,
          })}
        </Text>
      ) : mut.isError ? (
        <Text style={styles.error}>{t('recurrences.materializeError')}</Text>
      ) : null}
    </Panel>
  )
}

function defaultUntil(): Date {
  // Default = end of next month — same horizon as the dashboard forecast.
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 2, 0)
}

const styles = StyleSheet.create({
  title: {
    color: colors.fg,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  flex1: { flex: 1 },
  fieldButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldPressed: { backgroundColor: colors.surface3 },
  fieldValue: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  dismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
  },
  dismissLabel: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  success: {
    color: colors.positive,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
})
