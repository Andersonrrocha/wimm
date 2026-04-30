/**
 * Commit-time guard for installment fields on imported transactions.
 */

export type PersistedInstallment = {
  installmentCurrent: number
  installmentTotal: number
}

/**
 * Returns installment pair only when both values are integers and 1 <= current <= total.
 */
export function sanitizePersistedInstallment(
  current: number | undefined | null,
  total: number | undefined | null,
): PersistedInstallment | null {
  if (current == null || total == null) return null
  if (!Number.isInteger(current) || !Number.isInteger(total)) return null
  if (current < 1 || total < 1 || current > total) return null
  return { installmentCurrent: current, installmentTotal: total }
}
