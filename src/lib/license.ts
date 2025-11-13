// src/lib/license.ts
import { PLANS, type PlanId, resolvePlanId } from "./plans";

export type Kind = "product" | "user";

export type License = {
  plan: PlanId;
  status: "active" | "past_due" | "canceled";
  grace_days?: number;
  grace_until?: number; // epoch ms; if plan != free and status=past_due, blocks after this
  updatedAt: number;
};

const KEY = "sp.license";

// --- Base getters/setters ---
export function getLicense(): License {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const normalizedPlan = resolvePlanId(parsed.plan);
      if (normalizedPlan !== parsed.plan) {
        parsed.plan = normalizedPlan;
        parsed.updatedAt = Date.now();
        localStorage.setItem(KEY, JSON.stringify(parsed));
      }
      return parsed as License;
    }
  } catch {}
  const lic: License = { plan: "free", status: "active", updatedAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(lic)); } catch {}
  return lic;
}

export function setLicense(next: Partial<License>): License {
  const cur = getLicense();
  const plan = next.plan ? resolvePlanId(next.plan) : cur.plan;
  const lic: License = { ...cur, ...next, plan, updatedAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(lic)); } catch {}
  return lic;
}

// --- Limits helper ---
export function limits() {
  const { plan } = getLicense();
  return PLANS[plan];
}

// --- Billing read-only lock ---
export function isReadOnly(): boolean {
  const lic = getLicense();
  if (lic.plan === "free") return false;
  if (lic.status !== "past_due") return false;
  if (!lic.grace_until) return true;
  return Date.now() > lic.grace_until;
}

// --- Convenience caps ---
export function productCap()    { return PLANS[getLicense().plan].productsTotal; }
export function userCap()       { return PLANS[getLicense().plan].usersTotal; }
export function quickSalesCap() { return PLANS[getLicense().plan].dailyQuickSales; }
export function receiptsCap()   { return PLANS[getLicense().plan].dailyReceipts; }

// --- Legacy throws (used by callers) ---
export function assertCanMutateOrThrow(kind: Kind) {
  if (isReadOnly()) {
    throw new Error(`Your subscription is past due. ${capitalize(kind)} changes are blocked.`);
  }
}

export function assertWithinLimitOrThrow(kind: Kind, currentCount: number) {
  const lim = limits();
  const cap = kind === "product" ? lim.productsTotal : lim.usersTotal;
  if (currentCount >= cap) {
    throw new Error(`Plan limit reached for ${kind}s. Please upgrade.`);
  }
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
