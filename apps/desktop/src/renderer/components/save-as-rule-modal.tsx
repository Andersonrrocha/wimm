import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './ui/modal'
import { Button } from './ui/button'
import { Field } from './ui/field'

export interface SaveAsRuleModalProps {
  open: boolean
  onClose: () => void
  /** Initial pattern derived from the matched description. */
  defaultPattern: string
  /** Human-readable name of the category being targeted, for confirmation copy. */
  categoryName: string
  /** Save handler — caller wires the POST /categorization-rules call. */
  onSave: (pattern: string) => Promise<void>
  /** Set true while the parent is in flight. */
  saving?: boolean
}

/**
 * Lightweight confirmation modal that turns an AI suggestion into a permanent
 * user CategorizationRule. Pattern is editable; category is fixed (chosen
 * by the AI suggestion the user accepted).
 */
export function SaveAsRuleModal({
  open,
  onClose,
  defaultPattern,
  categoryName,
  onSave,
  saving = false,
}: SaveAsRuleModalProps): JSX.Element | null {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState(defaultPattern)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPattern(defaultPattern)
      setError(null)
    }
  }, [open, defaultPattern])

  const handleSave = async (): Promise<void> => {
    const trimmed = pattern.trim()
    if (trimmed.length < 2) {
      setError(t('saveAsRule.tooShort'))
      return
    }
    setError(null)
    try {
      await onSave(trimmed)
      onClose()
    } catch {
      setError(t('saveAsRule.failed'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('saveAsRule.title')}
      maxWidth={460}
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-wm-sm leading-relaxed text-fg-muted">
          {t('saveAsRule.body', { category: categoryName })}
        </p>
        <Field label={t('saveAsRule.patternLabel')}>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="w-full rounded-sm border border-line bg-surface-2 px-3 py-2 text-wm-sm text-fg focus:border-accent focus:outline-none"
            placeholder={t('saveAsRule.patternPlaceholder')}
            disabled={saving}
            autoFocus
          />
        </Field>
        {error ? <p className="m-0 text-wm-sm text-negative">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('saveAsRule.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? t('common.saving') : t('saveAsRule.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Heuristic: pick the first significant token in a description as the
 * default `contains` pattern. Punctuation stripped, short words ignored,
 * lowercased to match the resolver's normalization.
 */
export function suggestPatternFromDescription(description: string): string {
  const tokens = description
    .toLowerCase()
    .replace(/[^a-z0-9 áéíóúãâêôõçü]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  return tokens[0] ?? description.toLowerCase().trim().slice(0, 24)
}
