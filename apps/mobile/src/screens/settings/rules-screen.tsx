import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import type { CategorizationRule } from '@wimm/shared'
import { RuleFormModal } from '../../components/rules/rule-form-modal'
import { Button } from '../../components/ui/button'
import { Chip } from '../../components/ui/chip'
import { EmptyState } from '../../components/ui/empty-state'
import { Panel } from '../../components/ui/panel'
import { Screen } from '../../components/screen'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { colors, fontSize, radius, spacing } from '../../theme/tokens'

export function RulesScreen(): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['categorization-rules'],
    queryFn: async () => {
      const { data } = await apiClient.get<CategorizationRule[]>(
        '/categorization-rules',
      )
      return data
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categorization-rules/${id}`)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categorization-rules'] })
    },
    onError: () => {
      Alert.alert(t('rulesTab.failedLoad'))
    },
  })

  const toggleMut = useMutation({
    mutationFn: async (vars: { id: string; active: boolean }) => {
      await apiClient.patch(`/categorization-rules/${vars.id}`, {
        active: vars.active,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categorization-rules'] })
    },
  })

  const onLongPress = useCallback(
    (rule: CategorizationRule) => {
      Alert.alert(t('rulesTab.deleteConfirm'), rule.pattern, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteMut.mutate(rule.id),
        },
      ])
    },
    [deleteMut, t],
  )

  const sorted = useMemo(
    () => [...list].sort((a, b) => a.priority - b.priority),
    [list],
  )

  const stats = useMemo(() => {
    const active = list.filter((r) => r.active).length
    return { total: list.length, active }
  }, [list])

  return (
    <Screen scroll edges={[]}>
      <View style={styles.headRow}>
        <Text style={styles.subtitle}>
          {list.length === 0
            ? t('rulesTab.rulesSubtitleEmpty')
            : t('rulesTab.rulesSubtitle', stats)}
        </Text>
        <Button
          label={t('rulesTab.addRule')}
          variant="primary"
          size="sm"
          onPress={() => setShowForm(true)}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('settings.tabRules')}
          subtitle={t('rulesTab.emptyHint')}
          action={
            <Button
              label={t('rulesTab.addRule')}
              variant="primary"
              onPress={() => setShowForm(true)}
            />
          }
        />
      ) : (
        <Panel padding="sm">
          {sorted.map((rule, i) => (
            <View key={rule.id}>
              <Pressable
                onLongPress={() => onLongPress(rule)}
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.row,
                  !rule.active && styles.rowInactive,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowBody}>
                  <View style={styles.rowHead}>
                    <Text style={styles.priority}>#{rule.priority}</Text>
                    <Chip
                      label={
                        rule.matchType === 'CONTAINS'
                          ? t('rulesTab.matchContains')
                          : t('rulesTab.matchEquals')
                      }
                      tone="info"
                    />
                  </View>
                  <Text style={styles.pattern} numberOfLines={1}>
                    {rule.pattern}
                  </Text>
                  <Text style={styles.category} numberOfLines={1}>
                    → {categoryDisplayName(rule.category, t)}
                  </Text>
                </View>
                <Switch
                  value={rule.active}
                  onValueChange={(v) =>
                    toggleMut.mutate({ id: rule.id, active: v })
                  }
                  trackColor={{ false: colors.surface3, true: colors.accent }}
                  thumbColor={colors.fg}
                />
              </Pressable>
              {i < sorted.length - 1 ? (
                <View style={styles.separator} />
              ) : null}
            </View>
          ))}
        </Panel>
      )}

      <RuleFormModal visible={showForm} onClose={() => setShowForm(false)} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  subtitle: {
    color: colors.fgMuted,
    fontSize: fontSize.sm,
    flex: 1,
  },
  center: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.md,
  },
  rowInactive: {
    opacity: 0.55,
  },
  rowPressed: {
    backgroundColor: colors.surface2,
  },
  rowBody: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  priority: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  pattern: {
    color: colors.fg,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  category: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.lineSoft,
    marginHorizontal: spacing.sm,
  },
})
