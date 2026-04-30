import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPasswordRuleStates,
  isValidUsername,
  passwordMeetsAllRules,
} from "../lib/password-rules";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { PasswordInput } from "./ui/password-input";

type RegisterFormProps = {
  onSubmit: (input: {
    username: string;
    email: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<void>;
  loading: boolean;
  submitLabel: string;
};

export function RegisterForm({
  onSubmit,
  loading,
  submitLabel,
}: RegisterFormProps): JSX.Element {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showRules, setShowRules] = useState(false);

  const passwordRules = useMemo(
    () => getPasswordRuleStates(password, t),
    [password, t],
  );
  const passwordOk = passwordMeetsAllRules(password, t);
  const usernameOk = isValidUsername(username);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!usernameOk || !passwordOk) return;
    void onSubmit({
      username: username.trim().toLowerCase().replace(/\s+/g, " "),
      email: email.trim().toLowerCase(),
      password,
      rememberMe,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <Field
        label={t("auth.username")}
        error={
          username.length > 0 && !usernameOk
            ? t("auth.usernameInvalid")
            : undefined
        }
      >
        <Input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="John Doe"
          required
          minLength={3}
          maxLength={32}
          aria-invalid={username.length > 0 && !usernameOk}
        />
      </Field>

      <Field label={t("auth.email")}>
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </Field>

      <Field label={t("auth.password")}>
        <PasswordInput
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => setShowRules(true)}
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
        />
      </Field>

      {(showRules || password.length > 0) && (
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0"
          aria-live="polite"
        >
          {passwordRules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-2 text-wm-xs transition-colors duration-wm-fast",
                r.met ? "text-positive" : "text-fg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-pill border text-[10px] leading-none",
                  r.met
                    ? "border-positive bg-positive-soft"
                    : "border-line-soft",
                )}
                aria-hidden
              >
                {r.met ? "✓" : "○"}
              </span>
              {r.label}
            </li>
          ))}
        </ul>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-wm-sm text-fg-muted">
        <input
          type="checkbox"
          className="wm-check"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        {t("auth.rememberMe")}
      </label>

      <Button
        type="submit"
        variant="primary"
        disabled={loading || !usernameOk || !passwordOk}
        block
        className="mt-1"
      >
        {loading ? t("common.pleaseWait") : submitLabel}
      </Button>
    </form>
  );
}
