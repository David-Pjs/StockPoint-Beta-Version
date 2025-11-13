// src/lib/usage.ts
import type { PlanId } from "./plans";
import { PLANS } from "./plans";

/* ---------- types ---------- */
export type UsageKey = "quickSale" | "receipt" | "productTotal";

export type UsageDay = {
  date: string;             // YYYY-MM-DD
  quickSale: number;        // count for today
  receipt: number;          // count for today
  graceUsed?: boolean;      // for "soft-1day"
};

export type OverageLog = {
  at: number;               // epoch ms
  key: UsageKey;
  amount: number;           // how many over the base limit
  plan: PlanId;
};

export type CheckResult = {
  allowed: boolean;
  hardBlocked: boolean;
  remaining: number;        // remaining for today (or total, for products)
  used: number;             // used today (or total)
  limit: number;            // base limit (pre-grace)
  graceApplied: boolean;
  banner?: { tone: "warn" | "error"; message: string };
};

/* ---------- storage keys ---------- */
const DAY_KEY = (d: string) => `sp_usage_day:v1:${d}`;
const PROD_TOTAL_KEY = "sp_usage_products:v1";
const OVERAGE_LOG_KEY = "sp_overage_log:v1";
const ROLLING_GRACE_KEY = (k: UsageKey) => `sp_grace_roll:v1:${k}`; // timestamps[] (ms)

/* ---------- date ---------- */
export function getToday(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tz);
  return local.toISOString().slice(0, 10);
}

/* ---------- day read/write ---------- */
export function readDay(date: string): UsageDay {
  try {
    const raw = localStorage.getItem(DAY_KEY(date));
    if (raw) {
      const o = JSON.parse(raw);
      return {
        date,
        quickSale: Number(o.quickSale) || 0,
        receipt: Number(o.receipt) || 0,
        graceUsed: !!o.graceUsed,
      };
    }
  } catch {}
  return { date, quickSale: 0, receipt: 0, graceUsed: false };
}

export function writeDay(ud: UsageDay): void {
  try { localStorage.setItem(DAY_KEY(ud.date), JSON.stringify(ud)); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

/* ---------- products total ---------- */
export function readProductTotal(): number {
  try {
    const raw = localStorage.getItem(PROD_TOTAL_KEY);
    return raw ? Math.max(0, Number(JSON.parse(raw))) : 0;
  } catch { return 0; }
}
export function writeProductTotal(n: number): void {
  try { localStorage.setItem(PROD_TOTAL_KEY, JSON.stringify(Math.max(0, Math.floor(n)))); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

/* ---------- overage log ---------- */
export function logOverage(entry: OverageLog): void {
  try {
    const raw = localStorage.getItem(OVERAGE_LOG_KEY);
    const list: OverageLog[] = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    localStorage.setItem(OVERAGE_LOG_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {}
}

/* ---------- rolling grace history ---------- */
function readRolling(key: UsageKey): number[] {
  try {
    const raw = localStorage.getItem(ROLLING_GRACE_KEY(key));
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch { return []; }
}
function writeRolling(key: UsageKey, tsList: number[]) {
  try { localStorage.setItem(ROLLING_GRACE_KEY(key), JSON.stringify(tsList)); } catch {}
}

/* ---------- core checker ---------- */
export function checkAndConsume(plan: PlanId, key: UsageKey, amount = 1): CheckResult {
  const limits = PLANS[plan];
  const today = getToday();
  const now = Date.now();

  const baseResult = (used: number, limit: number): CheckResult => ({
    allowed: true,
    hardBlocked: false,
    remaining: Math.max(0, limit - used),
    used,
    limit,
    graceApplied: false,
  });

  if (key === "productTotal") {
    const used = readProductTotal();
    const limit = limits.productsTotal;
    const next = used + amount;

    if (plan === "free" && next > limit) {
      return {
        allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
        used, limit, graceApplied: false,
        banner: { tone: "error", message: "You’ve hit the Free plan limit. Upgrade to unlock more." },
      };
    }

    if (plan === "small") {
      const graceLimit = Math.ceil(limit * (1 + limits.gracePct));
      if (next <= limit) {
        writeProductTotal(next);
        return baseResult(next, limit);
      }
      // no soft-1day concept for totals → block at grace
      if (next <= graceLimit) {
        writeProductTotal(next);
        return {
          ...baseResult(next, limit),
          graceApplied: true,
          banner: { tone: "warn", message: "Temporary +10% allowance applied for products." },
        };
      }
      return {
        allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
        used, limit, graceApplied: false,
        banner: { tone: "error", message: "Product limit reached for your plan." },
      };
    }

    // large
    const graceLimit = Math.ceil(limit * (1 + limits.gracePct));
    if (next <= limit) {
      writeProductTotal(next);
      return baseResult(next, limit);
    }
    // single rolling usage per 30-day window
    const windowMs = (limits.graceWindowDays ?? 30) * 86400_000;
    const history = readRolling(key).filter(ts => now - ts < windowMs);
    if (history.length === 0 && next <= graceLimit) {
      writeProductTotal(next);
      writeRolling(key, [now]);
      logOverage({ at: now, key, amount: next - limit, plan });
      return {
        ...baseResult(next, limit),
        graceApplied: true,
        banner: { tone: "warn", message: "Grace applied (+15%). Admin notified to consider add-on." },
      };
    }
    return {
      allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
      used, limit, graceApplied: false,
      banner: { tone: "error", message: "Product limit reached for your plan." },
    };
  }

  // daily counters: quickSale / receipt
  const day = readDay(today);
  const used = key === "quickSale" ? day.quickSale : day.receipt;
  const limit = key === "quickSale" ? limits.dailyQuickSales : limits.dailyReceipts;
  const next = used + amount;

  // FREE – hard block
  if (plan === "free") {
    if (next > limit) {
      return {
        allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
        used, limit, graceApplied: false,
        banner: { tone: "error", message: "You’ve hit the Free plan limit. Upgrade to unlock more." },
      };
    }
    // commit
    if (key === "quickSale") day.quickSale = next; else day.receipt = next;
    writeDay(day);
    return baseResult(next, limit);
  }

  // SMALL – soft +10% once per day
  if (plan === "small") {
    const graceLimit = Math.ceil(limit * (1 + limits.gracePct));
    if (next <= limit) {
      if (key === "quickSale") day.quickSale = next; else day.receipt = next;
      writeDay(day);
      return baseResult(next, limit);
    }
    if (!day.graceUsed && next <= graceLimit) {
      if (key === "quickSale") day.quickSale = next; else day.receipt = next;
      day.graceUsed = true;
      writeDay(day);
      return {
        ...baseResult(next, limit),
        graceApplied: true,
        banner: { tone: "warn", message: "Temporary +10% allowance applied for today. Resets tomorrow." },
      };
    }
    return {
      allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
      used, limit, graceApplied: false,
      banner: { tone: "error", message: "Daily limit reached for your plan." },
    };
  }

  // LARGE – rolling +15% once per 30 days per key
  const graceLimit = Math.ceil(limit * (1 + limits.gracePct));
  if (next <= limit) {
    if (key === "quickSale") day.quickSale = next; else day.receipt = next;
    writeDay(day);
    return baseResult(next, limit);
  }
  const windowMs = (limits.graceWindowDays ?? 30) * 86400_000;
  const history = readRolling(key).filter(ts => now - ts < windowMs);
  if (history.length === 0 && next <= graceLimit) {
    if (key === "quickSale") day.quickSale = next; else day.receipt = next;
    writeDay(day);
    writeRolling(key, [now]);
    logOverage({ at: now, key, amount: next - limit, plan });
    return {
      ...baseResult(next, limit),
      graceApplied: true,
      banner: { tone: "warn", message: "Grace applied (+15%). Admin notified to consider add-on." },
    };
  }
  return {
    allowed: false, hardBlocked: true, remaining: Math.max(0, limit - used),
    used, limit, graceApplied: false,
    banner: { tone: "error", message: "Daily limit reached for your plan." },
  };
}
