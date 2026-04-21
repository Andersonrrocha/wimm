import { FormEvent, useState } from 'react'

type AuthFormProps = {
  onSubmit: (email: string, password: string) => Promise<void>
  loading: boolean
  submitLabel: string
}

export function AuthForm({
  onSubmit,
  loading,
  submitLabel,
}: AuthFormProps): JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    void onSubmit(email, password)
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <label className="wm-field">
        Email
        <input
          id="email"
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
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          className="wm-input"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="wm-btn wm-btn--primary"
        style={{ marginTop: 4 }}
      >
        {loading ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}
