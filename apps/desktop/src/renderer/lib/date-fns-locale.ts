import type { Locale } from 'date-fns/locale'
import { enUS } from 'date-fns/locale/en-US'
import { ptBR } from 'date-fns/locale/pt-BR'

/** Maps app locale (`en` | `pt`) to date-fns locale for formatting. */
export function dateFnsLocaleForLang(lang: string | undefined): Locale {
  return lang === 'pt' ? ptBR : enUS
}
