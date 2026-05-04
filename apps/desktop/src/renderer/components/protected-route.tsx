import { Navigate, useLocation } from "react-router-dom";
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
} as const;
