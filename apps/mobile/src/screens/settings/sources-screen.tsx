import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { Source, SourceType } from '@wimm/shared'
import { Chip } from '../../components/ui/chip'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { apiClient } from '../../lib/api-client'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

export function SourcesScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/sources/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: () => {
      Alert.alert(t('sourcesTab.failedLoad'))
    },
  })

  const onLongPress = useCallback(
    (src: Source) => {
      Alert.alert(t('sourcesTab.deleteConfirm', { name: src.name }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteMut.mutate(src.id),
        },
      ])
    },
    [deleteMut, t],
  )

  const sorted = useMemo(
    () => [...list].sort((a, b) => a.name.localeCompare(b.name)),
    [list],
  )

  return (
    <Screen scroll edges={[]}>
      <Text style={styles.subtitle}>{t('sourcesTab.subtitle')}</Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('sourcesTab.title')}
          subtitle={t('sourcesTab.emptyBody')}
        />
      ) : (
        <Panel padding="sm">
          {sorted.map((src, i) => (
            <View key={src.id}>
              <Pressable
                onLongPress={() => onLongPress(src)}
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>{src.name}</Text>
                  {src.type === 'CREDIT_CARD' && src.closingDay && src.dueDay ? (
                    <Text style={styles.rowMeta}>
                      {t('sourcesTab.billingCycleValue', {
                        closing: src.closingDay,
                        due: src.dueDay,
                      })}
                    </Text>
                  ) : null}
                </View>
                <Chip label={t(sourceTypeLabel(src.type))} tone="neutral" />
              </Pressable>
              {i < sorted.length - 1 ? (
                <View style={styles.separator} />
              ) : null}
            </View>
          ))}
        </Panel>
      )}
    </Screen>
  )
}

function sourceTypeLabel(type: SourceType): string {
  return `quickAdd.sourceType.${type}`
}

const styles = StyleSheet.create({
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  center: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface2,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.fg,
    fontSize: fontSize.md,
  },
  rowMeta: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  separator: {
    height: 1,
    backgroundColor: colors.lineSoft,
    marginHorizontal: spacing.sm,
  },
})
