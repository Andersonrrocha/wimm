import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { AppLocale } from '@wimm/shared'
import en from './locales/en.json'
import pt from './locales/pt.json'

const GUEST_LOCALE_KEY = 'wimm-locale-guest'

export function getGuestLocale(): AppLocale {
  try {
    const v = localStorage.getItem(GUEST_LOCALE_KEY)
    if (v === 'en' || v === 'pt') return v
  } catch {
    /* ignore */
  }
  return 'pt'
}

export function setGuestLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(GUEST_LOCALE_KEY, locale)
  } catch {
    /* ignore */
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
  lng: getGuestLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export async function applyLocale(locale: AppLocale): Promise<void> {
  setGuestLocale(locale)
  await i18n.changeLanguage(locale)
}

export default i18n
