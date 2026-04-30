import { TransactionKind } from '@prisma/client'
import { billingFieldsForProjectedInstallmentLeg } from './import-statement-billing.util'
import { computeProjectedInstallmentFingerprint } from './fingerprint'
import {
  resolveTransactionBillingFields,
  type SourceBillingInput,
} from '../transactions/transaction-billing.util'

function utcDaysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate()
}

function addCalendarMonths(
  year: number,
  month1To12: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = month1To12 - 1 + delta
  const y = year + Math.floor(zeroBased / 12)
  const m = ((zeroBased % 12) + 12) % 12
  return { year: y, month: m + 1 }
}

/**
 * Adds calendar months in UTC, clamping the day to the target month's length
 * (e.g. Jan 31 + 1 month → Feb 28/29).
 */
export function addCalendarMonthsUtc(d: Date, delta: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const { year, month } = addCalendarMonths(y, m, delta)
  const dim = utcDaysInMonth(year, month)
  const clamped = Math.min(day, dim)
  return new Date(Date.UTC(year, month - 1, clamped))
}

const PROJECTED_SUFFIX = (k: number, total: number) =>
  ` · ${k}/${total} (projected)`

export function buildProjectedInstallmentDescription(
  baseDescription: string,
  installmentCurrent: number,
  installmentTotal: number,
): string {
  const suffix = PROJECTED_SUFFIX(installmentCurrent, installmentTotal)
  const maxBase = 512 - suffix.length
  const base = baseDescription.trim().slice(0, Math.max(0, maxBase)).trimEnd()
  return `${base}${suffix}`
}

export type ProjectedInstallmentRow = {
  installmentCurrent: number
  occurredAt: Date
  description: string
  fingerprint: string
  billing: {
    billingCycleMonth: number | null
    billingCycleYear: number | null
    expectedDueDate: Date | null
  }
}

export type ImportStatementBillingBaseline = {
  dueDate: Date
  closingDate?: Date
}

/**
 * Builds future installment legs (importedCurrent + 1 … total) with monthly UTC
 * occurredAt, billing from {@link resolveTransactionBillingFields}, and fingerprints.
 */
export function buildProjectedInstallmentRows(args: {
  userId: string
  installmentPlanId: string
  sourceBilling: SourceBillingInput
  baseDescription: string
  baseOccurredAt: Date
  importedCurrent: number
  installmentTotal: number
  amount: number
  kind: TransactionKind
  /** When set (statement import snapshot), billing follows invoice due/closing instead of source rules. */
  importStatementBaseline?: ImportStatementBillingBaseline
}): ProjectedInstallmentRow[] {
  const {
    userId,
    installmentPlanId,
    sourceBilling,
    baseDescription,
    baseOccurredAt,
    importedCurrent,
    installmentTotal,
    amount,
    kind,
    importStatementBaseline,
  } = args

  const rows: ProjectedInstallmentRow[] = []
  for (let k = importedCurrent + 1; k <= installmentTotal; k++) {
    const monthsDelta = k - importedCurrent
    const occurredAt = addCalendarMonthsUtc(baseOccurredAt, monthsDelta)
    const billing = importStatementBaseline
      ? billingFieldsForProjectedInstallmentLeg({
          dueDateAfterDelta: addCalendarMonthsUtc(
            importStatementBaseline.dueDate,
            monthsDelta,
          ),
          closingDateAfterDelta:
            importStatementBaseline.closingDate !== undefined
              ? addCalendarMonthsUtc(
                  importStatementBaseline.closingDate,
                  monthsDelta,
                )
              : undefined,
        })
      : resolveTransactionBillingFields(sourceBilling, occurredAt)
    const description = buildProjectedInstallmentDescription(
      baseDescription,
      k,
      installmentTotal,
    )
    const fingerprint = computeProjectedInstallmentFingerprint(
      userId,
      installmentPlanId,
      k,
      occurredAt,
      kind,
      amount,
    )
    rows.push({
      installmentCurrent: k,
      occurredAt,
      description,
      fingerprint,
      billing,
    })
  }
  return rows
}
