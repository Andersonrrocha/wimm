import { Navigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";

type ProtectedRouteProps = {
  children: JSX.Element;
};

export function ProtectedRoute({ children }: ProtectedRouteProps): JSX.Element {
  const { state } = useAuth();

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
