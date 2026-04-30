/** Aligned with API `RegisterDto` password rules */

export const PASSWORD_MIN_LENGTH = 8

export type PasswordRuleId =
  | 'length'
  | 'upper'
  | 'lower'
  | 'digit'
  | 'symbol'

export type PasswordRuleState = {
  id: PasswordRuleId
  label: string
  met: boolean
}

/** i18n `t` for `auth.passwordRules.*` keys */
export type PasswordRuleTranslate = (
  key: string,
  options?: { count?: number },
) => string

export function getPasswordRuleStates(
  password: string,
  tr: PasswordRuleTranslate,
): PasswordRuleState[] {
  return [
    {
      id: 'length',
      label: tr('auth.passwordRules.length', {
        count: PASSWORD_MIN_LENGTH,
      }),
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'upper',
      label: tr('auth.passwordRules.upper'),
      met: /[A-Z]/.test(password),
    },
    {
      id: 'lower',
      label: tr('auth.passwordRules.lower'),
      met: /[a-z]/.test(password),
    },
    {
      id: 'digit',
      label: tr('auth.passwordRules.digit'),
      met: /\d/.test(password),
    },
    {
      id: 'symbol',
      label: tr('auth.passwordRules.symbol'),
      met: /[^A-Za-z0-9\s]/.test(password),
    },
  ]
}

export function passwordMeetsAllRules(
  password: string,
  tr: PasswordRuleTranslate,
): boolean {
  return getPasswordRuleStates(password, tr).every((r) => r.met)
}

/** Username: 3–32 chars; letters (incl. accents), digits, spaces, _, - */
export const USERNAME_RE = /^[\p{L}0-9 _-]{3,32}$/u

export function isValidUsername(raw: string): boolean {
  const s = raw.trim().replace(/\s+/g, ' ')
  return USERNAME_RE.test(s)
}
