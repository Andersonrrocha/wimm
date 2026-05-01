import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { AppLocale } from '@wimm/shared'
import en from './locales/en.json'
import pt from './locales/pt.json'

/**
 * Detect device language at boot. Falls back to `pt` to match the desktop
 * default. M3 will overwrite this with the authenticated user's
 * `preferredLocale` returned from `/users/me`.
 */
function detectInitialLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode
  return code === 'en' ? 'en' : 'pt'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
  lng: detectInitialLocale(),
  fallbackLng: 'pt',
  interpolation: { escapeValue: false },
})

export async function applyLocale(locale: AppLocale): Promise<void> {
  await i18n.changeLanguage(locale)
}

export default i18n
