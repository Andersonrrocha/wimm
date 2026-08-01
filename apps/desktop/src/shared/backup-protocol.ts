/**
 * Wire contract for the backup/export/restore IPC surface (`backups:*`),
 * Phase 4c task 4. Mirrors `profile-protocol.ts`'s own reasoning: main never
 * hands the renderer a raw filesystem path, only a `fileName` (a basename).
 * Restoring sends that exact string back, and `main/index.ts`'s
 * `backups:restore` handler re-derives the real, absolute path itself by
 * re-listing the real snapshots and preservation copies for the given
 * profile and matching on it (see `main/local-api.ts`'s
 * `restoreProfileFromBackup`) -- never by trusting a renderer-supplied path
 * directly. That is what keeps a compromised or buggy renderer from ever
 * being able to ask main to treat an arbitrary file on disk as one of a
 * profile's own backups.
 */

/** One backup entry as shown to the user -- a normal snapshot, or a last-resort preservation copy. */
export interface BackupSummary {
  /** Basename only -- e.g. `"<profileId>.<timestamp>.snapshot.db"`. Never a full path (see the module doc comment). */
  fileName: string
  /** ISO 8601 timestamp the snapshot/preservation copy was taken. */
  takenAt: string
  sizeBytes: number
  /**
   * The latest migration name applied to this backup's schema, or `null`
   * when it could not be determined (e.g. a preservation copy too corrupt
   * to open, or a backup older than the `_prisma_migrations` table itself).
   * Lets the restore picker tell the user which backups predate the update
   * that broke something -- the only question they actually have when
   * choosing among several (Phase 4c task 4, carry-over 2).
   */
  schemaVersion: string | null
}

/** Everything the restore picker needs for one profile. */
export interface ProfileBackups {
  /** Normal, validated snapshots -- safe restore candidates, newest first. */
  snapshots: BackupSummary[]
  /**
   * Pre-restore preservation copies that failed validation when they were
   * taken (Phase 4c task 4, carry-over 1) -- a clearly-labelled last resort,
   * never offered as a first choice. Newest first.
   */
  preservationCopies: BackupSummary[]
}

/** Result of `backups:export` -- `canceled: true` when the user dismissed the native save dialog without choosing a location. */
export type ExportResult = { canceled: true } | { canceled: false; path: string }
