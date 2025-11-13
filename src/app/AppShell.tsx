// src/app/AppShell.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCurrentUser, logout, subscribeChanges } from "../index";
import { getCompany } from "../lib/company";
import type { MinimalUser } from "../index";

function initials(name: string) {
  const parts = name.split(/\s+|_/g).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || name.slice(0, 2).toUpperCase();
}
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 55%)`;
}

export default function AppShell() {
  const [user, setUser] = useState<MinimalUser | null>(() => {
    try { return getCurrentUser(); } catch { return null; }
  });
  const [biz, setBiz] = useState<string>(() => {
    try {
      const c = getCompany();
      const name = (c?.name || "").trim();
      return name || "StockPoint";
    } catch {
      return "StockPoint";
    }
  });
  const [open, setOpen] = useState(false); // mobile menu
  const nav = useNavigate();
  const loc = useLocation();

  // ---- helpers to (re)read live state from storage / in-memory ----
  function refreshBrand() {
    try {
      const c = getCompany();
      const name = (c?.name || "").trim();
      setBiz(name || "StockPoint");
    } catch {
      setBiz("StockPoint");
    }
  }
  function refreshUser() {
    try {
      setUser(getCurrentUser());
    } catch {
      setUser(null);
    }
  }

  // Initial load already done by useState initializers above; still run a sync refresh
  useEffect(() => {
    refreshBrand();
    refreshUser();
  }, []);

  // React to cross-tab storage events AND to same-tab in-memory events
  useEffect(() => {
    // storage event covers cross-tab updates
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "__sp_changed__") return;
      refreshBrand();
      refreshUser();
    };

    // focus event to re-check on tab regain
    const onFocus = () => {
      refreshBrand();
      refreshUser();
    };

    // custom DOM event (sp:changed) — dispatched by signalChange() and also defensively by login/logout code
    const onDom = () => {
      refreshBrand();
      refreshUser();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("sp:changed", onDom);

    // subscribe to in-memory subscribers for same-tab immediate updates
    const unsub = subscribeChanges(() => {
      refreshBrand();
      refreshUser();
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sp:changed", onDom);
      unsub();
    };
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const isActive = (path: string) => loc.pathname === path;

  const userChip = useMemo(() => {
    if (!user) return null;
    return (
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-slate-900"
          style={{ background: colorFor(user.username) }}
          aria-hidden
        >
          {initials(user.username)}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm text-[var(--ink)] font-medium">{user.username}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--line)] text-[var(--muted)] w-max">
            {user.role}
          </span>
        </div>
      </div>
    );
  }, [user]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <header className="bg-[var(--panel)] border-b border-[var(--line)] sticky top-0 z-20">
        <div className="flex items-center max-w-6xl gap-3 px-4 py-3 mx-auto">
          <Link to="/" className="text-lg sm:text-xl font-semibold text-[var(--ink)] mr-auto">
            {biz}
          </Link>

          {/* Desktop nav */}
          {user && (
            <nav className="items-center hidden gap-4 mr-2 md:flex">
              <Link to="/" className={`nav-link ${isActive("/") ? "active" : ""}`}>Home</Link>
              <Link to="/products" className={`nav-link ${isActive("/products") ? "active" : ""}`}>Products</Link>
              <Link to="/sales" className={`nav-link ${isActive("/sales") ? "active" : ""}`}>Stock Sales</Link>
              <Link to="/transactions" className={`nav-link ${isActive("/transactions") ? "active" : ""}`}>Quick Sales</Link>
              <Link to="/reports" className={`nav-link ${isActive("/reports") ? "active" : ""}`}>Reports</Link>
              <Link to="/settings" className={`nav-link ${isActive("/settings") ? "active" : ""}`}>Settings</Link>
            </nav>
          )}

          {/* Right section */}
          <div className="items-center hidden gap-4 md:flex">
            {user ? (
              <>
                {userChip}
                <button
                  onClick={() => {
                    // logout() calls setSession(null) -> signalChange() so subscribers/dom listeners will update.
                    // We still defensively clear local state and navigate.
                    logout();
                    setUser(null);
                    nav("/login");
                    try { window.dispatchEvent(new CustomEvent("sp:changed")); } catch {}
                  }}
                  className="px-3 py-2 text-sm text-white bg-red-500 rounded-md hover:bg-red-600"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Login
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          {user && (
            <button
              className="md:hidden rounded-md border border-[var(--line)] px-2 py-1 text-sm"
              onClick={() => setOpen(v => !v)}
              aria-label="Toggle menu"
            >
              ☰
            </button>
          )}
        </div>

        {/* Mobile menu */}
        {user && open && (
          <div className="md:hidden border-t border-[var(--line)]">
            <div className="flex flex-col max-w-6xl gap-2 px-4 py-3 mx-auto">
              {userChip}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Link to="/" className={`nav-link ${isActive("/") ? "active" : ""}`}>Home</Link>
                <Link to="/products" className={`nav-link ${isActive("/products") ? "active" : ""}`}>Products</Link>
                <Link to="/sales" className={`nav-link ${isActive("/sales") ? "active" : ""}`}>Stock Sales</Link>
                <Link to="/transactions" className={`nav-link ${isActive("/transactions") ? "active" : ""}`}>Quick Sales</Link>
                <Link to="/reports" className={`nav-link ${isActive("/reports") ? "active" : ""}`}>Reports</Link>
                <Link to="/settings" className={`nav-link ${isActive("/settings") ? "active" : ""}`}>Settings</Link>
              </div>
              <button
                onClick={() => {
                  logout();
                  setUser(null);
                  nav("/login");
                  try { window.dispatchEvent(new CustomEvent("sp:changed")); } catch {}
                }}
                className="w-full px-3 py-2 mt-3 text-sm text-white bg-red-500 rounded-md hover:bg-red-600"
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page */}
      <main className="flex-1 w-full max-w-6xl px-4 py-6 mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
