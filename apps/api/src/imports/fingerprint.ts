import { createHash } from 'crypto'
import { TransactionKind } from '@prisma/client'

export function normalizeDescription(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** UTC calendar date YYYY-MM-DD for stable dedupe across time zones */
export function dateKeyUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function computeImportFingerprint(
  userId: string,
  sourceId: string,
  occurredAt: Date,
  kind: TransactionKind,
  amountAbsolute: number,
  description: string,
): string {
  const dk = dateKeyUtc(occurredAt)
  const amt = Math.abs(amountAbsolute).toFixed(2)
  const norm = normalizeDescription(description)
  const payload = [userId, sourceId, dk, kind, amt, norm].join('|')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/** Stable id for projected installment legs (distinct namespace from {@link computeImportFingerprint}). */
export function computeProjectedInstallmentFingerprint(
  userId: string,
  installmentPlanId: string,
  installmentCurrent: number,
  occurredAt: Date,
  kind: TransactionKind,
  amountAbsolute: number,
): string {
  const dk = dateKeyUtc(occurredAt)
  const amt = Math.abs(amountAbsolute).toFixed(2)
  const payload = [
    'wimm:proj_inst',
    userId,
    installmentPlanId,
    String(installmentCurrent),
    dk,
    kind,
    amt,
  ].join('|')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}
