import { useEffect, useMemo, useState } from "react";
import {
  money,
  getLicense,
  daysLeft,
  getBillingConfig,
  setBillingConfig,
  setLicenseDev,
  hasFeature,
  PLAN_META,
} from "../../index";
import ProfilePhotoCard from "./ProfilePhotoCard";
import ThemeToggle from "./ThemeToggle";
import CompanyProfileCard from "./CompanyProfileCard";
import TeamManager from "./TeamManager";
import Backup from "./Backup";
import { isAdmin } from "../../index";

type Tier = "small" | "large";
type BillingCfg = {
  smallUrl?: string;
  largeUrl?: string;
  plan2500?: string;
  plan5000?: string;
};

// Read backend URL from env (fallback to localhost:4000)
const API = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:4000";

function openNew(url?: string) {
  if (!url) return alert("No payment link configured yet.");
  window.open(url, "_blank", "noopener");
}

const TIER_AMOUNTS: Record<Tier, number> = {
  small: 250000, // ₦2,500 in kobo
  large: 500000, // ₦5,000 in kobo
};

const IS_DEV_HOST =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

export default function SettingsPage() {
  const admin = isAdmin();

  /* -------- Theme -------- */
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("sp_theme") || "dark");
  useEffect(() => {
    localStorage.setItem("sp_theme", theme);
    (document.documentElement as any).dataset.theme = theme;
  }, [theme]);

  /* -------- Billing / License (admin only UI) -------- */
  const [lic, setLic] = useState(() => getLicense());
  const [cfg, setCfg] = useState<BillingCfg>(() => (getBillingConfig() as BillingCfg));
  const left = useMemo(() => daysLeft(lic), [lic]);

  // Keep license panel fresh if anything in localStorage changes elsewhere
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__") setLic(getLicense());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* -------- Pay UI state (admin only) -------- */
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<Tier>("small"); // default ₦2,500
  const [mode, setMode] = useState<"one-time" | "plan">("one-time");
  const [loading, setLoading] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  // Ping backend so we fail fast with a clear message if URL/CORS is wrong
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`${API}/health`, { method: "GET" });
        if (!stop) setApiOk(r.ok);
      } catch {
        if (!stop) setApiOk(false);
      }
    })();
    return () => { stop = true; };
  }, []);

  const onSaveLinks = () => {
    setBillingConfig(cfg);
    setCfg(getBillingConfig() as BillingCfg);
    alert("Saved payment links.");
  };

  // ---- Direct backend calls (explicit callback_url) ----
  async function initOneTime(emailAddr: string, amountKobo: number): Promise<string> {
    const r = await fetch(`${API}/paystack/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailAddr,
        amount: amountKobo,
        callback_url: `${window.location.origin}/billing/callback`,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.data?.authorization_url) {
      throw new Error(data?.error || data?.message || "Failed to initialize payment. Check server logs.");
    }
    return data.data.authorization_url as string;
  }

  async function initPlan(emailAddr: string, planCode: string): Promise<string> {
    const r = await fetch(`${API}/paystack/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailAddr,
        plan: planCode,
        callback_url: `${window.location.origin}/billing/callback`,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.data?.authorization_url) {
      throw new Error(data?.error || data?.message || "Failed to initialize plan. Check server logs.");
    }
    return data.data.authorization_url as string;
  }

  async function handlePay() {
    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      alert("Enter a valid email for the receipt.");
      return;
    }
    if (apiOk === false) {
      alert(`Can't reach backend at ${API}. Set VITE_BACKEND_URL and restart the dev server.`);
      return;
    }
    setLoading(true);
    try {
      let url: string;
      if (mode === "one-time") {
        url = await initOneTime(email, TIER_AMOUNTS[tier]);
      } else {
        const planCode = tier === "small" ? (cfg.plan2500 || "") : (cfg.plan5000 || "");
        if (!planCode) {
          alert("No plan code set for this tier. Switch to One-time or add plan codes below.");
          setLoading(false);
          return;
        }
        url = await initPlan(email, planCode);
      }
      window.location.href = url; // Go to Paystack checkout
    } catch (e: any) {
      alert(e?.message || "Failed to initialize payment.");
      console.error("[PAY INIT ERROR]", e);
    } finally {
      setLoading(false);
    }
  }

  /* -------- DEV testing helpers (admin + localhost only) -------- */
  const [devDays, setDevDays] = useState<number>(left === Infinity ? 0 : Math.max(0, left));
  function devSet(plan: "free" | "trial" | "small" | "large", daysOverride?: number) {
    const next = setLicenseDev(plan, daysOverride);
    setLic(next);
  }

  const featureList = ["core", "trash", "backup", "export.csv", "reports.plus", "roles.all", "bulk.tools"];

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6 text-[var(--ink)]">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Backend status (admin only, since it's tied to billing server) */}
      {admin && (
        <div className="text-xs opacity-60">
          Backend: <code>{API}</code> — {apiOk === null ? "checking…" : apiOk ? "ok" : "unreachable"}
        </div>
      )}

      {/* ===== Admin-only: License / Billing / Payments ===== */}
      {admin && (
        <>
          {/* License */}
          <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)]">
            <h2 className="mb-2 text-lg font-semibold">License & Plan</h2>
            <div className="space-y-1 text-sm opacity-90">
              <div>Plan: <b className="uppercase">{lic.plan}</b></div>
              <div>
                {lic.expiresAt === 0 ? (
                  <>Status: <span className="text-[var(--ok)] font-medium">Free (no expiry)</span></>
                ) : left > 0 ? (
                  <>Status: <span className="text-[var(--ok)] font-medium">Active</span> — {left} day(s) left</>
                ) : (
                  <>Status: <span className="text-[var(--bad)] font-medium">Expired</span></>
                )}
              </div>
              {lic.lastPaymentRef ? <div>Last ref: {lic.lastPaymentRef}</div> : null}
            </div>
          </section>

          {/* Upgrade / Pay */}
          <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)] space-y-4">
            <h2 className="text-lg font-semibold">Upgrade to Pro</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Email for receipt
                <input
                  className="mt-1 w-full rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                  placeholder="you@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <div className="text-sm">
                Tier
                <div className="flex items-center gap-4 mt-1">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="tier" checked={tier === "small"} onChange={() => setTier("small")} />
                    Small — {money(2500)}
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="tier" checked={tier === "large"} onChange={() => setTier("large")} />
                    Large — {money(5000)}
                  </label>
                </div>
              </div>

              <div className="text-sm">
                Billing type
                <div className="flex items-center gap-4 mt-1">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="mode" checked={mode === "one-time"} onChange={() => setMode("one-time")} />
                    One-time (manual monthly)
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="mode" checked={mode === "plan"} onChange={() => setMode("plan")} />
                    Subscription (Paystack Plan)
                  </label>
                </div>
              </div>
            </div>

            <button
              onClick={handlePay}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-[var(--line)] hover:bg-[var(--line)]/50 disabled:opacity-60"
            >
              {loading ? "Initializing…" : "Go Pro"}
            </button>

            <p className="text-xs opacity-70">
              After payment, you'll be redirected back to <code>/billing/callback</code> where your license is verified.
            </p>
          </section>

          {/* Payment config */}
          <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)] space-y-3">
            <h2 className="text-lg font-semibold">Payment Config (optional)</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Small plan code (PLN…)
                <input
                  className="mt-1 w-full rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                  placeholder="PLN_2500..."
                  value={cfg.plan2500 || ""}
                  onChange={(e) => setCfg({ ...cfg, plan2500: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Large plan code (PLN…)
                <input
                  className="mt-1 w-full rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                  placeholder="PLN_5000..."
                  value={cfg.plan5000 || ""}
                  onChange={(e) => setCfg({ ...cfg, plan5000: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Small one-click link (optional)
                <input
                  className="mt-1 w-full rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                  placeholder="https://paystack.com/pay/..."
                  value={cfg.smallUrl || ""}
                  onChange={(e) => setCfg({ ...cfg, smallUrl: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Large one-click link (optional)
                <input
                  className="mt-1 w-full rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                  placeholder="https://paystack.com/pay/..."
                  value={cfg.largeUrl || ""}
                  onChange={(e) => setCfg({ ...cfg, largeUrl: e.target.value })}
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={onSaveLinks}>
                Save
              </button>
              <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => openNew(cfg.smallUrl)}>
                Test Small Link
              </button>
              <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => openNew(cfg.largeUrl)}>
                Test Large Link
              </button>
            </div>
          </section>

          {/* DEV panel – visible only on localhost */}
          {IS_DEV_HOST && (
            <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)] space-y-4">
              <h2 className="text-lg font-semibold">DEV: License Tester (local only)</h2>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2">
                  <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => devSet("free")}>Set FREE</button>
                  <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => devSet("trial", 14)}>Set TRIAL (14d)</button>
                  <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => devSet("small", devDays)}>Set SMALL ({devDays}d)</button>
                  <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => devSet("large", devDays)}>Set LARGE ({devDays}d)</button>
                </div>

                <label className="text-sm">
                  Days left
                  <input
                    type="number"
                    min={0}
                    className="ml-2 w-24 rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none"
                    value={devDays}
                    onChange={(e) => setDevDays(Math.max(0, Number(e.target.value || 0)))}
                    title="Set how many days are left when applying SMALL/LARGE"
                  />
                </label>

                <button
                  className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50"
                  onClick={() => devSet(lic.plan as any, 0)}
                  title="Make current plan expire immediately"
                >
                  Expire Now
                </button>
              </div>

              <div className="text-sm">
                <div className="mb-1 font-medium">Features (current plan)</div>
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
                  {featureList.map((f) => (
                    <li key={f}>{hasFeature(f, lic) ? "✅" : "❌"} <code>{f}</code></li>
                  ))}
                </ul>
                <div className="mt-3 text-xs opacity-70">
                  Plan limits — Users: <b>{PLAN_META[lic.plan].limits.users}</b>, Products: <b>{PLAN_META[lic.plan].limits.products}</b>
                </div>
              </div>
            </section>
          )}

          {/* Payments quick links */}
          <section className="mt-6 p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
            <h3 className="mb-2 text-lg font-semibold">Subscribe (Paystack)</h3>
            <p className="mb-3 text-sm opacity-75">Configure your Paystack product links below, then use these buttons to start checkout.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => openNew(cfg.smallUrl)}>
                Subscribe Pro (₦3,000/mo · ₦30,000/yr)
              </button>
              <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={() => openNew(cfg.largeUrl)}>
                Subscribe Enterprise (₦5,000/mo · ₦50,000/yr)
              </button>
            </div>
          </section>

          {/* Admin: Backup */}
          <section className="mt-6">
            <Backup />
          </section>

          {/* Admin: Team + Company */}
          <section className="mt-6">
            <TeamManager />
          </section>
          <section className="mt-6">
            <CompanyProfileCard />
          </section>
        </>
      )}

      {/* ===== Non-admins see only general settings below ===== */}
      <section className="mt-6">
        <ThemeToggle />
      </section>
      <section className="mt-6">
        <ProfilePhotoCard />
      </section>
    </div>
  );
}
