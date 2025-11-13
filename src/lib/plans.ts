// src/lib/plans.ts
export type PlanId = "free" | "small" | "large";

export type Limits = {
  // totals
  productsTotal: number;
  usersTotal: number;

  // per-day activity caps
  dailyQuickSales: number;
  dailyReceipts: number;

  // grace behavior
  grace: "none" | "soft-1day" | "soft-rolling";
  gracePct: number;           // 0.10 => +10%
  graceWindowDays?: number;   // 1 for Small, 30 for Large
};

export const PLANS: Record<PlanId, Limits> = {
  free: {
    productsTotal: 80,
    usersTotal: 1,
    dailyQuickSales: 25,
    dailyReceipts: 15,
    grace: "none",
    gracePct: 0,
  },
  small: {
    productsTotal: 400,
    usersTotal: 3,
    dailyQuickSales: 200,
    dailyReceipts: 120,
    grace: "soft-1day",
    gracePct: 0.10,
    graceWindowDays: 1,
  },
  large: {
    productsTotal: 5000,
    usersTotal: Number.MAX_SAFE_INTEGER,
    dailyQuickSales: 2000,
    dailyReceipts: 1200,
    grace: "soft-rolling",
    gracePct: 0.15,
    graceWindowDays: 30,
  },
};

// Normalize incoming plan strings (e.g. "pro" → small, "enterprise" → large)
export function resolvePlanId(input: string | undefined | null): PlanId {
  const s = String(input || "").toLowerCase();
  if (s.startsWith("lar") || s.startsWith("ent")) return "large";
  if (s.startsWith("sma") || s === "pro") return "small";
  return "free";
}
