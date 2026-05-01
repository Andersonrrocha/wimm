import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import type { Category, Recurrence, Source } from '@wimm/shared'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterializePanel } from '../components/recurrences/materialize-panel'
import { RecurrenceCard } from '../components/recurrences/recurrence-card'
import { RecurrenceFormModal } from '../components/recurrences/recurrence-form-modal'
import { apiClient } from '../lib/api-client'
import { categoryDisplayName } from '../lib/category-label'
import { colors, spacing } from '../theme/tokens'

type FormState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; recurrence: Recurrence }

export function RecurrencesScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>({ mode: 'closed' })

  const {
    data: list = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['recurrences'],
    queryFn: async () => {
      const { data } = await apiClient.get<Recurrence[]>('/recurrences')
      return data
    },
  })

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const sourceById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sources) m.set(s.id, s.name)
    return m
  }, [sources])
  const categoryById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, categoryDisplayName(c, t))
    return m
  }, [categories, t])

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/recurrences/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })

  const onLongPress = useCallback(
    (rec: Recurrence) => {
      Alert.alert(
        t('recurrences.deleteConfirm'),
        rec.description,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => deleteMut.mutate(rec.id),
          },
        ],
      )
    },
    [deleteMut, t],
  )

  const totalActive = list.filter((r) => r.active).length

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={colors.fgMuted}
          />
        }
      >
        <PageHeader
          eyebrow={t('recurrences.eyebrow')}
          title={t('recurrences.pageTitle')}
          subtitle={
            list.length > 0
              ? t('recurrences.rulesSubtitle', {
                  total: list.length,
                  active: totalActive,
                })
              : t('recurrences.pageSubtitle')
          }
          trailing={
            <Button
              label={t('recurrences.addRule')}
              variant="primary"
              size="sm"
              onPress={() => setForm({ mode: 'new' })}
            />
          }
        />

        <MaterializePanel />

        <View style={styles.spacer} />

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : list.length === 0 ? (
          <EmptyState
            title={t('recurrences.rulesEmptySubtitle')}
            subtitle={t('recurrences.emptyHint')}
            action={
              <Button
                label={t('recurrences.addRule')}
                variant="primary"
                onPress={() => setForm({ mode: 'new' })}
              />
            }
          />
        ) : (
          <View style={styles.list}>
            {list.map((rec) => (
              <RecurrenceCard
                key={rec.id}
                recurrence={rec}
                categoryName={
                  rec.categoryId ? categoryById.get(rec.categoryId) : undefined
                }
                sourceName={
                  rec.sourceId ? sourceById.get(rec.sourceId) : undefined
                }
                onEdit={() => setForm({ mode: 'edit', recurrence: rec })}
                onLongPress={() => onLongPress(rec)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <RecurrenceFormModal
        visible={form.mode !== 'closed'}
        onClose={() => setForm({ mode: 'closed' })}
        initial={form.mode === 'edit' ? form.recurrence : null}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + 80,
  },
  spacer: { height: spacing.lg },
  list: { gap: spacing.sm },
  center: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
})
