import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import wimmLogo from "../assets/images/wimm-logo.png";
import { QuickAddModal, type QuickAddTab } from "./quick-add-modal";

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: "/", label: "Home", end: true },
  { to: "/transactions", label: "Transactions" },
  { to: "/imports", label: "Import" },
  { to: "/recurrences", label: "Recurrences" },
  { to: "/settings", label: "Settings" },
];

const navLinkStyle = (active: boolean): CSSProperties => ({
  color: active ? "var(--wm-text)" : "var(--wm-text-muted)",
  textDecoration: "none",
  fontSize: "var(--wm-fs-sm)",
  padding: "0.38rem 0.7rem",
  borderRadius: "var(--wm-radius-sm)",
  background: active ? "var(--wm-surface-2)" : "transparent",
  transition: "color 140ms, background 140ms",
  whiteSpace: "nowrap",
});

export function AppLayout(): JSX.Element {
  const { logout, state } = useAuth();
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<QuickAddTab>("transaction");

  const openQuickAdd = useCallback((tab: QuickAddTab = "transaction"): void => {
    setInitialTab(tab);
    setQuickAddOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openQuickAdd("transaction");
      }
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd]);

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login");
  };

  const session = state.status === "authenticated" ? state.user : null;
  const userBadgeLabel = session?.username ?? "";
  const userBadgeTitle = session
    ? `${session.username} · ${session.email}`
    : "";

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <NavLink
          to="/"
          end
          style={({ isActive }) => ({
            ...styles.brand,
            opacity: isActive ? 1 : 0.92,
          })}
          title="Wimm — home"
          aria-label="Wimm home"
        >
          <img
            src={wimmLogo}
            alt="Wimm"
            style={styles.logoImg}
            decoding="async"
          />
        </NavLink>
        <nav style={styles.nav} aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => navLinkStyle(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={styles.headerActions}>
          <button
            type="button"
            className="wm-btn wm-btn--primary"
            onClick={() => openQuickAdd("transaction")}
            title="Quick add (⌘/Ctrl + K)"
          >
            <span aria-hidden style={{ fontWeight: 700 }}>
              +
            </span>
            Add
            <kbd style={styles.kbd}>⌘K</kbd>
          </button>
          {userBadgeLabel ? (
            <span style={styles.userBadge} title={userBadgeTitle}>
              @{userBadgeLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleLogout}
            className="wm-btn wm-btn--subtle"
          >
            Sign out
          </button>
        </div>
      </header>
      <main style={styles.main}>
        <Outlet context={{ openQuickAdd }} />
      </main>
      <QuickAddModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        initialTab={initialTab}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "var(--wm-bg)",
    color: "var(--wm-text)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0 1.25rem",
    height: "var(--wm-header-h)",
    borderBottom: "1px solid var(--wm-border-soft)",
    background: "linear-gradient(180deg, #101014 0%, #0c0c10 100%)",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    marginRight: 12,
    flexShrink: 0,
    textDecoration: "none",
    color: "inherit",
    opacity: 1,
    transition: "opacity 140ms",
  },
  logoImg: {
    display: "block",
    height: 32,
    width: "auto",
    maxWidth: "min(160px, 38vw)",
    objectFit: "contain",
    objectPosition: "left center",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
    overflow: "auto",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  userBadge: {
    fontSize: "var(--wm-fs-xs)",
    color: "var(--wm-text-muted)",
    padding: "0.3rem 0.55rem",
    borderRadius: "var(--wm-radius-sm)",
    background: "var(--wm-surface-1)",
    border: "1px solid var(--wm-border-soft)",
    maxWidth: 180,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  kbd: {
    fontSize: "0.65rem",
    padding: "1px 5px",
    borderRadius: 4,
    background: "rgba(0, 0, 0, 0.25)",
    color: "#1a1a1a",
    fontWeight: 600,
    marginLeft: 2,
  },
  main: {
    flex: 1,
    padding: "24px 32px 48px",
    overflow: "auto",
  },
};
