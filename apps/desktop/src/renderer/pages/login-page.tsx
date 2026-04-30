import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import { AuthBrand } from "../components/auth-brand";
import { AuthForm } from "../components/auth-form";
import {
  authCardClassName,
  authScreenClassName,
} from "../lib/auth-screen-classes";

export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (
    email: string,
    password: string,
    rememberMe: boolean,
  ): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      await login({ email, password }, rememberMe);
      navigate("/");
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 401) {
        const raw = (e.response.data as { message?: string | string[] })
          ?.message;
        const code = Array.isArray(raw) ? raw[0] : raw;
        if (code === "USER_NOT_FOUND") {
          setError(t("auth.noAccountForEmail"));
        } else {
          setError(t("auth.invalidCredentials"));
        }
      } else {
        setError(t("auth.invalidCredentials"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={authScreenClassName}>
      <div className={authCardClassName}>
        <AuthBrand />
        <AuthForm
          onSubmit={handleSubmit}
          loading={loading}
          submitLabel={t("auth.signIn")}
        />
        {error && (
          <p className="m-0 text-center text-wm-sm text-negative">{error}</p>
        )}
        <p className="mt-1.5 text-center text-wm-sm text-fg-muted">
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="wm-link">
            {t("auth.createOne")}
          </Link>
        </p>
      </div>
    </div>
  );
}
