import { IsIn, IsOptional } from 'class-validator'

const LOCALES = ['en', 'pt'] as const
const CHART_DATE_MODES = ['BILLING_CYCLE', 'PURCHASE_DATE'] as const
const AI_MODES = ['OFF', 'ON'] as const

export type PreferredLocaleDto = (typeof LOCALES)[number]
export type ChartDateModeDto = (typeof CHART_DATE_MODES)[number]
export type AiCategorizationModeDto = (typeof AI_MODES)[number]

/**
 * Self-service profile patch. Subscription / founder fields are intentionally
 * not editable here — they go through admin scripts (and the paywall sprint).
 */
export class UpdateMeDto {
  @IsOptional()
  @IsIn(LOCALES)
  preferredLocale?: PreferredLocaleDto

  @IsOptional()
  @IsIn(CHART_DATE_MODES)
  chartDateMode?: ChartDateModeDto

  @IsOptional()
  @IsIn(AI_MODES)
  aiCategorizationMode?: AiCategorizationModeDto
}
