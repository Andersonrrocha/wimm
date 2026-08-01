import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackupSummary, ProfileBackups as ProfileBackupsPayload } from '../../shared/backup-protocol'
import type { ProfileSummary } from '../../shared/profile-protocol'
import { useAuth } from '../context/auth-context'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import { Select } from './ui/select'

/** `sizeBytes` as a short, human-readable string -- "482 KB", "1.3 MB". */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatTakenAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

type RestoreTarget = { profile: ProfileSummary; backup: BackupSummary; isUnvalidated: boolean }

/**
 * Local-mode-only Settings section (Phase 4c task 4) for exporting the
 * active profile and restoring any registered profile from one of its own
 * backups. Renders nothing outside local mode, mirroring `ProfileSwitcher`.
 *
 * **Export** always targets the currently active profile (design decision
 * D8) -- `window.backups.export()` opens a native save dialog in main and,
 * unless canceled, copies the profile's `.db` file to wherever the user
 * chose. The AI-key notice below is shown unconditionally, before the user
 * ever clicks Export, not just after: they need to know the consequence
 * before they act on it, not discover it afterward.
 *
 * **Restore** can target ANY registered profile, not only the active one --
 * see `main/local-api.ts`'s `restoreProfileFromBackup` doc comment for why
 * ("the multi-profile recovery path"). The profile selector only renders
 * when more than one profile exists; with exactly one, its own backups are
 * shown directly. Two groups are always kept visually distinct: ordinary,
 * validated snapshots, and (carry-over 1) unvalidated preservation copies,
 * offered only as a clearly-labelled last resort. Every entry shows its
 * schema version (carry-over 2) -- the one question a person choosing among
 * several backups actually has: which of these predate the update that
 * broke something.
 *
 * Restoring the ACTIVE profile reloads the renderer afterward, the same way
 * `ProfileSwitcher` does after a successful switch -- a full remount is the
 * only way to guarantee nothing left over from the pre-restore state (a
 * cached transaction list, stale React Query data) survives. Restoring a
 * DIFFERENT, non-active profile does not: nothing about the running app
 * changed, so only this section's own list is refreshed.
 */
export function ProfileBackupsSection(): JSX.Element | null {
  const { t } = useTranslation()
  const { mode } = useAuth()

  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [backups, setBackups] = useState<ProfileBackupsPayload | null>(null)
  const [backupsError, setBackupsError] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEffect(() => {
    if (mode?.mode !== 'local' || !window.profiles) return
    let cancelled = false

    void Promise.all([window.profiles.list(), window.profiles.getSituation()])
      .then(([list, situation]) => {
        if (cancelled) return
        setProfiles(list)
        const currentId = situation.kind === 'ready' ? (situation.profile?.id ?? null) : null
        setActiveProfileId(currentId)
        setSelectedProfileId(currentId ?? list[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [mode])

  const loadBackups = useCallback((profileId: string): void => {
    setBackupsError(null)
    void window.backups
      .list(profileId)
      .then((result) => setBackups(result))
      .catch((err: unknown) => {
        setBackups(null)
        setBackupsError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => {
    if (!selectedProfileId) return
    loadBackups(selectedProfileId)
  }, [selectedProfileId, loadBackups])

  if (mode?.mode !== 'local') return null

  const handleExport = async (): Promise<void> => {
    if (exporting) return
    setExportError(null)
    setExportedPath(null)
    setExporting(true)
    try {
      const result = await window.backups.export()
      if (!result.canceled) {
        setExportedPath(result.path)
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const openRestoreConfirm = (profile: ProfileSummary, backup: BackupSummary, isUnvalidated: boolean): void => {
    setRestoreError(null)
    setRestoreTarget({ profile, backup, isUnvalidated })
  }

  const handleConfirmRestore = async (): Promise<void> => {
    if (!restoreTarget || restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      await window.backups.restore(restoreTarget.profile.id, restoreTarget.backup.fileName)
      if (restoreTarget.profile.id === activeProfileId) {
        // Restoring the running profile -- reload, exactly like
        // ProfileSwitcher does after a switch, so nothing pre-restore
        // survives in memory.
        window.location.reload()
        return
      }
      // A different, non-active profile was restored -- nothing about the
      // running app changed. Refresh this section's own list and close the
      // confirmation.
      setRestoreTarget(null)
      loadBackups(restoreTarget.profile.id)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }

  const profileOptions = (profiles ?? []).map((p) => ({
    value: p.id,
    label: p.id === activeProfileId ? `${p.name} ${t('settings.profiles.current')}` : p.name,
  }))

  const selectedProfile = (profiles ?? []).find((p) => p.id === selectedProfileId) ?? null

  return (
    <div>
      <h3 className="m-0 text-wm-md font-medium text-fg">{t('settings.backups.title')}</h3>
      <p className="mt-1.5 text-wm-sm text-fg-muted">{t('settings.backups.subtitle')}</p>

      {loadError ? (
        <p className="mt-2 text-wm-sm text-negative">{loadError}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {/* --- Export --------------------------------------------------- */}
          <div className="rounded-sm border border-line bg-surface-2 p-3">
            <h4 className="m-0 text-wm-sm font-medium text-fg">{t('settings.backups.exportTitle')}</h4>
            <p className="mt-1.5 text-wm-sm text-fg-muted">{t('settings.backups.exportBody')}</p>
            <p className="mt-1.5 text-wm-xs text-fg-muted">{t('settings.backups.exportAiKeyNotice')}</p>
            <div className="mt-2.5">
              <Button variant="ghost" size="sm" disabled={exporting} onClick={() => void handleExport()}>
                {exporting ? t('common.pleaseWait') : t('settings.backups.exportButton')}
              </Button>
            </div>
            {exportedPath ? (
              <p className="mt-2 text-wm-sm text-fg-muted">{t('settings.backups.exportSuccess', { path: exportedPath })}</p>
            ) : null}
            {exportError ? <p className="mt-2 text-wm-sm text-negative">{exportError}</p> : null}
          </div>

          {/* --- Restore ---------------------------------------------------- */}
          <div className="rounded-sm border border-line bg-surface-2 p-3">
            <h4 className="m-0 text-wm-sm font-medium text-fg">{t('settings.backups.restoreTitle')}</h4>
            <p className="mt-1.5 text-wm-sm text-fg-muted">{t('settings.backups.restoreBody')}</p>

            {profileOptions.length > 1 && selectedProfileId ? (
              <div className="mt-2.5 max-w-xs">
                <Select
                  value={selectedProfileId}
                  onChange={(id) => setSelectedProfileId(id)}
                  options={profileOptions}
                  ariaLabel={t('settings.backups.restoreProfileLabel')}
                />
              </div>
            ) : null}

            {backupsError ? (
              <p className="mt-2 text-wm-sm text-negative">{backupsError}</p>
            ) : backups && backups.snapshots.length === 0 && backups.preservationCopies.length === 0 ? (
              <p className="mt-2 text-wm-sm text-fg-muted">{t('settings.backups.noSnapshots')}</p>
            ) : backups ? (
              <div className="mt-2.5 flex flex-col gap-3">
                {backups.snapshots.length > 0 ? (
                  <BackupList
                    title={t('settings.backups.snapshotsGroup')}
                    entries={backups.snapshots}
                    onRestore={(backup) => selectedProfile && openRestoreConfirm(selectedProfile, backup, false)}
                    restoreLabel={t('settings.backups.restoreButton')}
                  />
                ) : null}
                {backups.preservationCopies.length > 0 ? (
                  <div>
                    <p className="m-0 text-wm-xs text-fg-muted">{t('settings.backups.preservationHint')}</p>
                    <BackupList
                      title={t('settings.backups.preservationGroup')}
                      entries={backups.preservationCopies}
                      onRestore={(backup) => selectedProfile && openRestoreConfirm(selectedProfile, backup, true)}
                      restoreLabel={t('settings.backups.restoreButton')}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Modal
        open={restoreTarget !== null}
        onClose={() => (restoring ? undefined : setRestoreTarget(null))}
        title={t('settings.backups.restoreConfirmTitle')}
      >
        {restoreTarget ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-wm-sm text-fg">
              {t('settings.backups.restoreConfirmBody', {
                profile: restoreTarget.profile.name,
                date: formatTakenAt(restoreTarget.backup.takenAt),
              })}
            </p>
            {restoreTarget.isUnvalidated ? (
              <p className="m-0 text-wm-sm text-negative">{t('settings.backups.preservationHint')}</p>
            ) : null}
            {restoreError ? <p className="m-0 text-wm-sm text-negative">{restoreError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="subtle" size="sm" disabled={restoring} onClick={() => setRestoreTarget(null)}>
                {t('settings.backups.restoreCancel')}
              </Button>
              <Button variant="danger" size="sm" disabled={restoring} onClick={() => void handleConfirmRestore()}>
                {restoring ? t('common.pleaseWait') : t('settings.backups.restoreConfirmAction')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function BackupList({
  title,
  entries,
  onRestore,
  restoreLabel,
}: {
  title: string
  entries: BackupSummary[]
  onRestore: (backup: BackupSummary) => void
  restoreLabel: string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div>
      <p className="m-0 text-wm-xs font-medium uppercase tracking-wide text-fg-muted">{title}</p>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-2 p-0">
        {entries.map((backup) => (
          <li
            key={backup.fileName}
            className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface-1 px-3 py-2"
          >
            <div className="flex flex-col">
              <span className="text-wm-sm text-fg">{formatTakenAt(backup.takenAt)}</span>
              <span className="text-wm-xs text-fg-muted">
                {backup.schemaVersion
                  ? t('settings.backups.schemaVersionLabel', { version: backup.schemaVersion })
                  : t('settings.backups.schemaVersionUnknown')}
                {' · '}
                {formatSize(backup.sizeBytes)}
              </span>
            </div>
            <Button variant="subtle" size="sm" onClick={() => onRestore(backup)}>
              {restoreLabel}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
