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

export function getPasswordRuleStates(password: string): PasswordRuleState[] {
  return [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'upper',
      label: 'One uppercase letter',
      met: /[A-Z]/.test(password),
    },
    {
      id: 'lower',
      label: 'One lowercase letter',
      met: /[a-z]/.test(password),
    },
    {
      id: 'digit',
      label: 'One number',
      met: /\d/.test(password),
    },
    {
      id: 'symbol',
      label: 'One symbol (not a letter or digit)',
      met: /[^A-Za-z0-9\s]/.test(password),
    },
  ]
}

export function passwordMeetsAllRules(password: string): boolean {
  return getPasswordRuleStates(password).every((r) => r.met)
}

/** Username: 3–32 chars, letters, numbers, underscore, hyphen */
export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/

export function isValidUsername(raw: string): boolean {
  const s = raw.trim()
  return USERNAME_RE.test(s)
}
