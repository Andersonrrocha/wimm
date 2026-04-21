import { FormEvent, useMemo, useState } from 'react'
import {
  getPasswordRuleStates,
  isValidUsername,
  passwordMeetsAllRules,
} from '../lib/password-rules'

type RegisterFormProps = {
  onSubmit: (input: {
    username: string
    email: string
    password: string
  }) => Promise<void>
  loading: boolean
  submitLabel: string
}

export function RegisterForm({
  onSubmit,
  loading,
  submitLabel,
}: RegisterFormProps): JSX.Element {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showRules, setShowRules] = useState(false)

  const passwordRules = useMemo(
    () => getPasswordRuleStates(password),
    [password],
  )
  const passwordOk = passwordMeetsAllRules(password)
  const usernameOk = isValidUsername(username)

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (!usernameOk || !passwordOk) return
    void onSubmit({
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      password,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <label className="wm-field">
        Username
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your_name"
          className="wm-input"
          required
          minLength={3}
          maxLength={32}
          aria-invalid={username.length > 0 && !usernameOk}
        />
      </label>
      {username.length > 0 && !usernameOk ? (
        <p className="wm-error-text" style={{ margin: '-6px 0 0', fontSize: '0.8rem' }}>
          3–32 characters: letters, numbers, underscore or hyphen only.
        </p>
      ) : null}

      <label className="wm-field">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="wm-input"
        />
      </label>

      <label className="wm-field">
        Password
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => setShowRules(true)}
          placeholder="••••••••"
          autoComplete="new-password"
          className="wm-input"
          minLength={8}
          maxLength={128}
        />
      </label>

      {(showRules || password.length > 0) && (
        <ul className="wm-password-rules" aria-live="polite">
          {passwordRules.map((r) => (
            <li
              key={r.id}
              className={`wm-password-rules__item${r.met ? ' wm-password-rules__item--met' : ''}`}
            >
              <span className="wm-password-rules__check" aria-hidden>
                {r.met ? '✓' : '○'}
              </span>
              {r.label}
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={loading || !usernameOk || !passwordOk}
        className="wm-btn wm-btn--primary"
        style={{ marginTop: 4 }}
      >
        {loading ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}
