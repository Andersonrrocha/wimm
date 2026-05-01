import {
  endOfMonth,
  endOfYear,
  format,
  parse,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
} from 'date-fns'
import type { Locale } from 'date-fns/locale'
import { enUS } from 'date-fns/locale/en-US'
import { ptBR } from 'date-fns/locale/pt-BR'

export const ISO_DATE = 'yyyy-MM-dd'

export function dateFnsLocaleForLang(lang: string | undefined): Locale {
  return lang?.startsWith('pt') ? ptBR : enUS
}

export function toIsoDate(date: Date): string {
  return format(date, ISO_DATE)
}

export function fromIsoDate(value: string): Date | null {
  if (!value) return null
  const parsed = parse(value, ISO_DATE, new Date())
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseFlexibleDate(value: string): Date | null {
  if (!value) return null
  const viaIsoDate = fromIsoDate(value)
  if (viaIsoDate) return viaIsoDate
  const iso = parseISO(value)
  return Number.isNaN(iso.getTime()) ? null : iso
}

export function formatShortDate(
  value: string | Date,
  locale: Locale = enUS,
): string {
  const d = value instanceof Date ? value : parseFlexibleDate(value)
  if (!d) return typeof value === 'string' ? value : ''
  return format(d, 'MMM d', { locale })
}

export function formatMediumDate(
  value: string | Date,
  locale: Locale = enUS,
): string {
  const d = value instanceof Date ? value : parseFlexibleDate(value)
  if (!d) return typeof value === 'string' ? value : ''
  return format(d, 'MMM d, yyyy', { locale })
}

export function formatDateTime(
  value: string | Date,
  locale: Locale = enUS,
): string {
  const d = value instanceof Date ? value : parseFlexibleDate(value)
  if (!d) return typeof value === 'string' ? value : ''
  return format(d, 'MMM d, yyyy · HH:mm', { locale })
}

export function formatTime(value: Date): string {
  return format(value, 'HH:mm')
}

export type RangePreset = 'mtd' | 'last30' | 'ytd'

export interface DateRange {
  from: string
  to: string
}

export function computeRange(
  preset: RangePreset,
  now: Date = new Date(),
): DateRange {
  switch (preset) {
    case 'mtd':
      return {
        from: toIsoDate(startOfMonth(now)),
        to: toIsoDate(endOfMonth(now)),
      }
    case 'last30':
      return {
        from: toIsoDate(subDays(now, 29)),
        to: toIsoDate(now),
      }
    case 'ytd':
      return {
        from: toIsoDate(startOfYear(now)),
        to: toIsoDate(endOfYear(now)),
      }
  }
}
