import { normalizeDescription } from './fingerprint'

/** Must match {@link buildProjectedInstallmentDescription} suffix in installment-projection.util. */
const PROJECTED_SUFFIX_RE = / · \d+\/\d+ \(projected\)$/

export function stripProjectedInstallmentDescriptionSuffix(
  description: string,
): string {
  return description.replace(PROJECTED_SUFFIX_RE, '').trimEnd()
}

export function projectedDescriptionMatchesImport(
  projectedDescription: string,
  importDescription: string,
): boolean {
  const base = stripProjectedInstallmentDescriptionSuffix(projectedDescription)
  return (
    normalizeDescription(base) === normalizeDescription(importDescription.trim())
  )
}

export type ProjectedCandidate = { id: string; description: string }

/**
 * Narrows DB candidates by normalized merchant/description (excluding projected suffix).
 * Returns a single id only when exactly one row matches — otherwise null (avoid false positives).
 */
export function pickUniqueReconcilableCandidate(
  candidates: ProjectedCandidate[],
  importDescription: string,
): string | null {
  const matches = candidates.filter((c) =>
    projectedDescriptionMatchesImport(c.description, importDescription),
  )
  if (matches.length !== 1) return null
  return matches[0].id
}
