import { IsIn, IsOptional } from 'class-validator'

const LOCALES = ['en', 'pt'] as const

export type PreferredLocaleDto = (typeof LOCALES)[number]

export class UpdateMeDto {
  @IsOptional()
  @IsIn(LOCALES)
  preferredLocale?: PreferredLocaleDto
}
