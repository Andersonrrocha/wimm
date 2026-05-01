/**
 * Locale-aware money formatter. Returns the original input on parse failure
 * so the UI degrades gracefully instead of showing "NaN".
 */
export function formatMoney(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (Number.isNaN(n)) return String(amount)
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
