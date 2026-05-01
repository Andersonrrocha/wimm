import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Category, CategoryType } from '@wimm/shared'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { PickerModal, type PickerOption } from '../ui/picker-modal'
import { apiClient } from '../../lib/api-client'
import { categoryDisplayName } from '../../lib/category-label'
import { colors, fontSize, radius, spacing, tracking } from '../../theme/tokens'

interface CategoryFormProps {
  onDone: () => void
}

export function CategoryForm({ onDone }: CategoryFormProps): JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [type, setType] = useState<CategoryType>('EXPENSE')
  const [parentId, setParentId] = useState('')
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [showParentPicker, setShowParentPicker] = useState(false)

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const typeOptions: PickerOption[] = useMemo(
    () => [
      { value: 'EXPENSE', label: t('quickAdd.categoryType.EXPENSE') },
      { value: 'INCOME', label: t('quickAdd.categoryType.INCOME') },
    ],
    [t],
  )

  const parentOptions: PickerOption[] = useMemo(() => {
    const tops = categories
      .filter((c) => !c.parentId && c.type === type)
      .map((c) => ({ value: c.id, label: categoryDisplayName(c, t) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [
      { value: '', label: t('quickAdd.categoryParentNone') },
      ...tops,
    ]
  }, [categories, type, t])

  // Clear parent if type changes and parent no longer matches
  useEffect(() => {
    const valid = new Set(
      categories
        .filter((c) => !c.parentId && c.type === type)
        .map((c) => c.id),
    )
    if (parentId && !valid.has(parentId)) setParentId('')
  }, [categories, type, parentId])

  const typeLabel = type === 'EXPENSE'
    ? t('quickAdd.categoryType.EXPENSE')
    : t('quickAdd.categoryType.INCOME')
  const parentLabel = parentId
    ? categoryDisplayName(
        categories.find((c) => c.id === parentId) ?? {
          name: '',
          categoryKey: null,
        },
        t,
      ) || t('quickAdd.categoryParentNone')
    : t('quickAdd.categoryParentNone')

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/categories', {
        name: name.trim(),
        type,
        ...(parentId ? { parentId } : {}),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] })
      onDone()
    },
  })

  const isValid = name.trim() !== ''

  return (
    <View style={styles.form}>
      <Field label={t('categoriesTab.name')}>
        <Input
          value={name}
          onChangeText={setName}
          placeholder={t('quickAdd.placeholders.categoryName')}
          autoFocus
        />
      </Field>

      <Field label={t('categoriesTab.type')}>
        <Pressable
          onPress={() => setShowTypePicker(true)}
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldPressed]}
        >
          <Text style={styles.fieldValue}>{typeLabel}</Text>
        </Pressable>
      </Field>

      <Field
        label={t('quickAdd.categoryParent')}
        hint={t('quickAdd.categoryParentHint')}
      >
        <Pressable
          onPress={() => setShowParentPicker(true)}
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldPressed]}
        >
          <Text style={styles.fieldValue}>{parentLabel}</Text>
        </Pressable>
      </Field>

      {createMut.isError ? (
        <Text style={styles.error}>{t('quickAdd.couldNotSave')}</Text>
      ) : null}

      <Button
        label={
          createMut.isPending
            ? t('quickAdd.saving')
            : t('quickAdd.saveCategory')
        }
        variant="primary"
        block
        loading={createMut.isPending}
        disabled={!isValid || createMut.isPending}
        onPress={() => createMut.mutate()}
      />

      <PickerModal
        visible={showTypePicker}
        onClose={() => setShowTypePicker(false)}
        title={t('categoriesTab.type')}
        options={typeOptions}
        selected={type}
        onSelect={(v) => setType(v as CategoryType)}
      />
      <PickerModal
        visible={showParentPicker}
        onClose={() => setShowParentPicker(false)}
        title={t('quickAdd.categoryParent')}
        options={parentOptions}
        selected={parentId}
        onSelect={setParentId}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  fieldButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldPressed: {
    backgroundColor: colors.surface3,
  },
  fieldValue: {
    color: colors.fg,
    fontSize: fontSize.md,
    letterSpacing: tracking.base,
  },
  error: {
    color: colors.negative,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
})
