type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[]

/**
 * Tiny `classnames` replacement — no runtime dependency.
 * Accepts strings, arrays, and `{ [class]: boolean }` objects.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v))
    } else if (Array.isArray(v)) {
      const nested = cn(...v)
      if (nested) out.push(nested)
    } else if (typeof v === 'object') {
      for (const [key, truthy] of Object.entries(v)) {
        if (truthy) out.push(key)
      }
    }
  }
  return out.join(' ')
}
