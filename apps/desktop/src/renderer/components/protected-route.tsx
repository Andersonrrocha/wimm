import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/auth-context";

type ProtectedRouteProps = {
  children: JSX.Element;
};

export function ProtectedRoute({ children }: ProtectedRouteProps): JSX.Element {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") {
    return (
      <div style={styles.loading}>
        <span style={styles.dot} />
      </div>
    );
  }

  // Local mode only -- see auth-context.tsx's doc comment on why this is a
  // distinct state from `unauthenticated` rather than collapsed into it:
  // there is no login screen in local mode that could ever resolve this,
  // so this renders its own, visibly-a-failure screen instead of quietly
  // sending the user somewhere they cannot get out of.
  if (state.status === "local-backend-error") {
    return <LocalBackendErrorScreen detail={state.detail} />;
  }

  if (state.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  // First-run gate: send the user to onboarding until they finish it.
  // The onboarding route itself uses ProtectedRoute too — bypass the check
  // there to avoid an infinite redirect.
  if (
    state.user.onboardedAt === null &&
    location.pathname !== "/onboarding"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function LocalBackendErrorScreen({ detail }: { detail: string }): JSX.Element {
  const { t } = useTranslation();

  return (
    <div style={styles.errorScreen}>
      <div style={styles.errorCard}>
        <h1 style={styles.errorTitle}>{t("localBackendError.title")}</h1>
        <p style={styles.errorBody}>{t("localBackendError.body")}</p>
        <p style={styles.errorDetail}>
          {t("localBackendError.detailLabel")}: {detail}
        </p>
        <button
          type="button"
          style={styles.reloadButton}
          onClick={() => window.location.reload()}
        >
          {t("localBackendError.reload")}
        </button>
      </div>
    </div>
  );
}

const styles = {
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#0f0f0f",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#6366f1",
    opacity: 0.8,
  },
  errorScreen: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#0f0f0f",
    padding: "2rem",
  },
  errorCard: {
    maxWidth: "32rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
    color: "#f4f4f5",
  },
  errorTitle: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "#f87171",
  },
  errorBody: {
    margin: 0,
    color: "#d4d4d8",
  },
  errorDetail: {
    margin: 0,
    fontFamily: "monospace",
    fontSize: "0.85rem",
    color: "#a1a1aa",
    wordBreak: "break-word" as const,
  },
  reloadButton: {
    alignSelf: "flex-start",
    marginTop: "0.5rem",
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    border: "1px solid #3f3f46",
    background: "#18181b",
    color: "#f4f4f5",
    cursor: "pointer",
  },
} as const;
