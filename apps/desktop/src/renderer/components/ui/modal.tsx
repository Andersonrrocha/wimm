import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: number
  headerExtra?: ReactNode
}

/**
 * Modal primitive: fixed backdrop, ESC to close, click on backdrop closes,
 * initial focus on first focusable inside the modal, body scroll locked.
 * Renders via portal so stacking contexts above the app shell don't clip it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth,
  headerExtra,
}: ModalProps): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return (): void => {
      document.body.style.overflow = original
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return (): void => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const node = bodyRef.current
    if (!node) return
    const first = node.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-wm-close])',
    )
    first?.focus()
  }, [open])

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  const onDialogKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation()
  }

  if (!open) return null

  return createPortal(
    <div
      className="wm-modal-backdrop"
      role="presentation"
      onMouseDown={onBackdropClick}
    >
      <div
        className="wm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onDialogKey}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <header className="wm-modal__header">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flex: 1,
              minWidth: 0,
            }}
          >
            <h2 className="wm-modal__title">{title}</h2>
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="wm-modal__close"
            aria-label="Close"
            data-wm-close
          >
            ×
          </button>
        </header>
        <div className="wm-modal__body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
