import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

type State =
  | { kind: 'idle' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; version: string }
  | { kind: 'downloaded'; version: string }

/**
 * Surfaces electron-updater events as a non-blocking toast in the bottom-right.
 * `available` → silently waits for `downloaded`; user clicks "Restart" to install.
 *
 * Renders nothing in dev (window.updater is undefined when not packaged).
 */
export function UpdateToast(): JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    const updater = window.updater
    if (!updater) return

    let lastVersion = ''
    const offAvailable = updater.onUpdateAvailable(({ version }) => {
      lastVersion = version
      setState({ kind: 'available', version })
    })
    const offProgress = updater.onDownloadProgress(({ percent }) => {
      setState({ kind: 'downloading', percent, version: lastVersion })
    })
    const offDownloaded = updater.onUpdateDownloaded(({ version }) => {
      lastVersion = version
      setState({ kind: 'downloaded', version })
    })
    const offError = updater.onUpdateError(() => {
      setState({ kind: 'idle' })
    })
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  if (state.kind === 'idle' || state.kind === 'available') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3.5 py-2 text-wm-sm text-[#d4d5de] shadow-wm-soft"
    >
      {state.kind === 'downloading' && (
        <span>
          {t('updater.downloading', { percent: Math.round(state.percent) })}
        </span>
      )}
      {state.kind === 'downloaded' && (
        <>
          <span>{t('updater.readyToRestart', { version: state.version })}</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.updater?.quitAndInstall()}
          >
            {t('updater.restartNow')}
          </Button>
        </>
      )}
    </div>
  )
}
