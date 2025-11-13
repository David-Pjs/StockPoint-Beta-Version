// src/components/Login.tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getUsers, login } from "../../index";
import { getAvatar } from "../../lib/avatars";
import { useNavigate } from "react-router-dom";

type Role = "admin" | "accountant" | "staff";
type Profile = { id: string; username: string; role: Role };

function initials(name: string) {
  const parts = name.split(/\s+|_/g).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || name.slice(0, 2).toUpperCase();
}
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 60% 55%)`;
}

// simple client-side throttle per user
const FAIL_KEY = (u: string) => `sp_fail:${u}`;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30_000;

function readFail(u: string) {
  try {
    const raw = localStorage.getItem(FAIL_KEY(u));
    return raw ? (JSON.parse(raw) as { count: number; until?: number }) : { count: 0 };
  } catch {
    return { count: 0 };
  }
}
function writeFail(u: string, v: { count: number; until?: number }) {
  try {
    localStorage.setItem(FAIL_KEY(u), JSON.stringify(v));
  } catch {}
}
function clearFail(u: string) {
  try {
    localStorage.removeItem(FAIL_KEY(u));
  } catch {}
}

export default function Login() {
  const navigate = useNavigate();

  // original profiles list (unchanged)
  const profiles = useMemo<Profile[]>(
    () =>
      getUsers().map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role as Role,
      })),
    []
  );

  // NEW: simple search filter (does not change any business logic)
  const [query, setQuery] = useState("");
  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.username.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q)
    );
  }, [profiles, query]);

  const [selected, setSelected] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState<number>(0); // ms remaining if locked

  // redirect to onboarding if no users exist
  useEffect(() => {
    if (profiles.length === 0) navigate("/register", { replace: true });
  }, [profiles.length, navigate]);

  // when switching profile, reset UI and check lock status
  useEffect(() => {
    setPin("");
    setError(null);
    if (!selected) return;
    const f = readFail(selected.username);
    const now = Date.now();
    setLockedFor(f.until && f.until > now ? f.until - now : 0);

    const t = setInterval(() => {
      const now2 = Date.now();
      const remain = f.until && f.until > now2 ? f.until - now2 : 0;
      setLockedFor(remain > 0 ? remain : 0);
      if (remain <= 0) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [selected]);

  // SUBMIT
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;

    // lock check
    const f = readFail(selected.username);
    const now = Date.now();
    if (f.until && f.until > now) {
      setLockedFor(f.until - now);
      setError("Too many attempts. Try again shortly.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await login(selected.username, pin);
      clearFail(selected.username);

      // At this point setSession() inside login() already calls signalChange()
      // which notifies same-tab subscribers and writes __sp_changed__ for other tabs.
      // Additionally dispatch a DOM event for compatibility with components listening to window.
      try { window.dispatchEvent(new CustomEvent("sp:changed")); } catch {}

      navigate("/", { replace: true });
    } catch (err: any) {
      // bump failures, set lock if needed
      const next = { count: (f.count || 0) + 1 } as { count: number; until?: number };
      if (next.count >= MAX_ATTEMPTS) {
        next.until = Date.now() + LOCK_MS;
      }
      writeFail(selected.username, next);
      setError(err?.message || "Invalid credentials");
      const left = Math.max(0, MAX_ATTEMPTS - next.count);
      if (!next.until) {
        setError(
          `Invalid credentials. ${left} attempt${left === 1 ? "" : "s"} remaining before temporary lock.`
        );
      } else {
        setLockedFor(LOCK_MS);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] px-4 py-10 flex flex-col items-center">
      <h1 className="text-2xl font-semibold text-slate-100">Welcome</h1>
      <p className="mt-1 text-sm text-slate-400">Select your profile to continue</p>

      {/* Search filter */}
      <div className="w-full max-w-lg mt-5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search user or role…"
          className="w-full control"
          aria-label="Search profiles"
        />
      </div>

      {/* Profiles grid */}
      <div className="grid grid-cols-2 gap-4 mt-6 sm:grid-cols-3 md:grid-cols-4">
        {filteredProfiles.map((p) => {
          const avatarUrl = getAvatar(p.id); // use saved profile photo if available
          const isSelected = selected?.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`group w-36 h-36 rounded-2xl border border-[#1f2742] bg-[#0f172a] hover:border-slate-500 focus:outline-none transition
                ${isSelected ? "ring-2 ring-emerald-400" : ""}`}
              type="button"
            >
              <div className="flex items-center justify-center w-16 h-16 mx-auto mt-6 overflow-hidden rounded-full">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={`${p.username} avatar`}
                    className="object-cover w-16 h-16"
                  />
                ) : (
                  <div
                    className="grid w-16 h-16 font-bold rounded-full place-items-center text-slate-900"
                    style={{ background: colorFor(p.username) }}
                    aria-hidden
                  >
                    {initials(p.username)}
                  </div>
                )}
              </div>
              <div className="mt-3 text-sm font-medium truncate text-slate-200">{p.username}</div>
              <div className="text-[11px] text-slate-400">{p.role}</div>
            </button>
          );
        })}
        {filteredProfiles.length === 0 && (
          <div className="text-sm text-center col-span-full text-slate-400">
            No matching users.
          </div>
        )}
      </div>

      {/* PIN form */}
      {selected && (
        <form
          onSubmit={onSubmit}
          className="mt-6 w-full max-w-sm rounded-2xl bg-[#0f172a] border border-[#1f2742] p-5"
          autoComplete="off"
        >
          {/* decoy fields to soak up password managers */}
          <input
            type="text"
            name="fake_user"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
          />
          <input
            type="password"
            name="fake_pass"
            autoComplete="new-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
          />

          <div className="text-sm text-slate-300">
            PIN for <b>{selected.username}</b>
          </div>

          <div className="relative mt-2">
            <input
              className="w-full rounded-lg bg-[#0b1220] border border-[#1f2742] px-3 py-2 text-slate-100 outline-none tracking-widest"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              name="pin_code"
              autoComplete="one-time-code"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="••••••"
              maxLength={6}
              minLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ""))}
              disabled={lockedFor > 0}
              autoFocus
            />
            {lockedFor > 0 && (
              <div className="absolute text-xs -translate-y-1/2 right-2 top-1/2 text-amber-300">
                {Math.ceil(lockedFor / 1000)}s
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || lockedFor > 0 || pin.length < 4}
            className="w-full px-4 py-2 mt-4 font-medium rounded-xl bg-emerald-500 text-slate-900 disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Continue"}
          </button>

          <p className="mt-3 text-xs text-slate-500">
            Tip: to prevent saved-password popups on this screen, disable “Autofill passwords” for
            <code className="mx-1">localhost</code> in your browser settings.
          </p>
        </form>
      )}
    </div>
  );
}
