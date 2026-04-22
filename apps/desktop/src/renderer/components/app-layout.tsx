import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import wimmLogo from "../assets/images/wimm-logo.png";
import { QuickAddModal, type QuickAddTab } from "./quick-add-modal";
import { Button } from "./ui/button";
import { cn } from "../lib/cn";

const NAV_KEYS: { to: string; labelKey: string; end?: boolean }[] = [
  { to: "/", labelKey: "nav.home", end: true },
  { to: "/transactions", labelKey: "nav.transactions" },
  { to: "/imports", labelKey: "nav.imports" },
  { to: "/recurrences", labelKey: "nav.recurrences" },
  { to: "/settings", labelKey: "nav.settings" },
];

const navLinkClass = (active: boolean): string =>
  cn(
    "whitespace-nowrap rounded-sm px-2.5 py-1.5 text-wm-sm no-underline",
    "transition-colors duration-wm-fast",
    active
      ? "bg-surface-2 text-fg"
      : "text-fg-muted hover:text-fg hover:bg-surface-1",
  );

export function AppLayout(): JSX.Element {
  const { t } = useTranslation();
  const { logout, state } = useAuth();
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<QuickAddTab>("transaction");

  const navItems = useMemo(
    () =>
      NAV_KEYS.map((item) => ({
        ...item,
        label: t(item.labelKey),
      })),
    [t],
  );

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
    <div className="flex min-h-screen flex-col bg-surface-app text-fg">
      <header className="sticky top-0 z-10 flex h-header flex-shrink-0 items-center gap-4 border-b border-line-soft bg-gradient-to-b from-[#101014] to-[#0c0c10] px-5">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              "mr-3 flex shrink-0 items-center text-fg no-underline transition-opacity duration-wm-fast",
              isActive ? "opacity-100" : "opacity-90",
            )
          }
          title={t("layout.logoHome")}
          aria-label={t("layout.logoHome")}
        >
          <img
            src={wimmLogo}
            alt={t("layout.logoAlt")}
            className="block h-8 w-auto max-w-[min(160px,38vw)] object-contain object-left"
            decoding="async"
          />
        </NavLink>
        <nav
          className="flex min-w-0 flex-1 items-center gap-1 overflow-auto"
          aria-label={t("layout.primaryNavAria")}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => navLinkClass(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <Button
            variant="primary"
            onClick={() => openQuickAdd("transaction")}
            title={t("layout.quickAddTitle")}
          >
            <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            {t("layout.add")}
            <kbd
              className={cn(
                "ml-0.5 inline-flex h-[1.34rem] shrink-0 items-center justify-center gap-0.5",
                "rounded-xs bg-black/30 px-2 text-[0.7rem] font-semibold leading-none",
                "text-[#1a1a1a]",
              )}
              aria-hidden
            >
              <span className="leading-none text-[0.9rem]">⌘</span>
              <span className="leading-none">K</span>
            </kbd>
          </Button>
          {userBadgeLabel ? (
            <span
              className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border border-line-soft bg-surface-1 px-2 py-1 text-wm-xs text-fg-muted"
              title={userBadgeTitle}
            >
              @{userBadgeLabel}
            </span>
          ) : null}
          <Button variant="subtle" onClick={handleLogout}>
            {t("layout.signOut")}
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto px-8 pb-12 pt-6">
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
