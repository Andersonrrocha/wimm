import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'

const LOCALES = ['en', 'pt'] as const
const CHART_DATE_MODES = ['BILLING_CYCLE', 'PURCHASE_DATE'] as const
const AI_MODES = ['OFF', 'SERVER', 'BYOK'] as const

export type PreferredLocaleDto = (typeof LOCALES)[number]
export type ChartDateModeDto = (typeof CHART_DATE_MODES)[number]
export type AiCategorizationModeDto = (typeof AI_MODES)[number]

/**
 * Self-service profile patch. Subscription / founder fields are intentionally
 * not editable here — they go through admin scripts (and the paywall sprint).
 *
 * `aiApiKey` is asymmetric: a string sets/replaces the BYOK key (server
 * encrypts before storing); `null` clears it; `undefined` leaves it alone.
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

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(256)
  @Matches(/^sk-ant-[A-Za-z0-9_-]{20,}$/, {
    message: 'aiApiKey must be a valid Anthropic key (starts with sk-ant-).',
  })
  aiApiKey?: string | null
}
