// src/lib/receipts.ts
import { getLicense, PLAN_META } from "../index";

const KEY = "sp_receipts_count:v1";

function getCount(): number {
  try { return parseInt(localStorage.getItem(KEY) || "0", 10) || 0; } catch { return 0; }
}
function setCount(n: number) {
  try { localStorage.setItem(KEY, String(n)); } catch {}
}

export function canGenerateReceipt(): boolean {
  const lic = getLicense();
  // Free plan cap: 5 receipts total
  if (lic.plan === "free" || lic.plan === "trial") {
    return getCount() < 5;
  }
  return true; // small/large unlimited
}

export function recordReceipt(): void {
  const lic = getLicense();
  if (lic.plan === "free" || lic.plan === "trial") {
    setCount(getCount() + 1);
  }
}
