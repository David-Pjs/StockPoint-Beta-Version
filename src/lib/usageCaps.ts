// src/lib/usageGuards.ts
import { getLicense } from "./license";
import { PLANS } from "./plans";
import { readDay, getToday, readProductTotal, checkAndConsume, type CheckResult } from "./usage";

// Peek (no mutation)
export function peekQuickSales() {
  const plan = getLicense().plan;
  const caps = PLANS[plan];
  const d = readDay(getToday());
  const used = Number(d.quickSale || 0);
  const limit = caps.dailyQuickSales;
  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}
export function peekReceipts() {
  const plan = getLicense().plan;
  const caps = PLANS[plan];
  const d = readDay(getToday());
  const used = Number(d.receipt || 0);
  const limit = caps.dailyReceipts;
  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}
export function peekProductsTotal(activeCount?: number) {
  const plan = getLicense().plan;
  const caps = PLANS[plan];
  const used = typeof activeCount === "number" ? activeCount : readProductTotal();
  const limit = caps.productsTotal;
  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}

// Consume (writes via usage.ts)
export function tryConsumeQuickSales(amount = 1): CheckResult {
  const plan = getLicense().plan;
  return checkAndConsume(plan, "quickSale", amount);
}
export function tryConsumeReceipts(amount = 1): CheckResult {
  const plan = getLicense().plan;
  return checkAndConsume(plan, "receipt", amount);
}
export function tryConsumeProductTotal(amount = 1): CheckResult {
  const plan = getLicense().plan;
  return checkAndConsume(plan, "productTotal", amount);
}
