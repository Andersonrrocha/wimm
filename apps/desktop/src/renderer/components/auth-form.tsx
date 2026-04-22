import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { Field } from './ui/field'
import { Input } from './ui/input'
import { PasswordInput } from './ui/password-input'

type AuthFormProps = {
  onSubmit: (
    email: string,
    password: string,
    rememberMe: boolean,
  ) => Promise<void>
  loading: boolean
  submitLabel: string
}

export function AuthForm({
  onSubmit,
  loading,
  submitLabel,
}: AuthFormProps): JSX.Element {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    void onSubmit(email, password, rememberMe)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <Field label={t('auth.email')}>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </Field>
      <Field label={t('auth.password')}>
        <PasswordInput
          id="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-wm-sm text-fg-muted">
        <input
          type="checkbox"
          className="wm-check"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        {t('auth.rememberMe')}
      </label>
      <Button
        type="submit"
        variant="primary"
        disabled={loading}
        block
        className="mt-1"
      >
        {loading ? t('common.pleaseWait') : submitLabel}
      </Button>
    </form>
  )
}
