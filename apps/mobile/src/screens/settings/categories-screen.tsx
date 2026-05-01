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
import type { Category } from '@wimm/shared'
import { Button } from '../../components/ui/button'
import { Chip } from '../../components/ui/chip'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { useQuickAdd } from '../../context/quick-add-context'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

export function CategoriesScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { open: openQuickAdd } = useQuickAdd()

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categories/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] })
    },
    onError: () => {
      Alert.alert(t('categoriesTab.failedLoad'))
    },
  })

  const onLongPress = useCallback(
    (cat: Category) => {
      const name = categoryDisplayName(cat, t)
      Alert.alert(t('categoriesTab.deleteConfirm', { name }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteMut.mutate(cat.id),
        },
      ])
    },
    [deleteMut, t],
  )

  const sorted = useMemo(
    () =>
      [...list].sort((a, b) =>
        categoryDisplayName(a, t).localeCompare(categoryDisplayName(b, t)),
      ),
    [list, t],
  )

  const stats = useMemo(() => {
    const income = list.filter((c) => c.type === 'INCOME').length
    const expense = list.filter((c) => c.type === 'EXPENSE').length
    return { income, expense, total: list.length }
  }, [list])

  return (
    <Screen scroll edges={[]}>
      <Text style={styles.subtitle}>
        {list.length === 0
          ? t('categoriesTab.subtitleEmpty')
          : t('categoriesTab.subtitle', stats)}
      </Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('categoriesTab.title')}
          subtitle={t('categoriesTab.emptyBody')}
          action={
            <Button
              label={t('categoriesTab.newCategory')}
              variant="primary"
              onPress={() => openQuickAdd('category')}
            />
          }
        />
      ) : (
        <Panel padding="sm">
          {sorted.map((cat, i) => (
            <View key={cat.id}>
              <Pressable
                onLongPress={() => onLongPress(cat)}
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>
                    {categoryDisplayName(cat, t)}
                  </Text>
                  {cat.parent ? (
                    <Text style={styles.rowMeta}>
                      {cat.parent.name}
                    </Text>
                  ) : null}
                </View>
                <Chip
                  label={
                    cat.type === 'INCOME'
                      ? t('quickAdd.categoryType.INCOME')
                      : t('quickAdd.categoryType.EXPENSE')
                  }
                  tone={cat.type === 'INCOME' ? 'positive' : 'negative'}
                />
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
  },
  separator: {
    height: 1,
    backgroundColor: colors.lineSoft,
    marginHorizontal: spacing.sm,
  },
})
