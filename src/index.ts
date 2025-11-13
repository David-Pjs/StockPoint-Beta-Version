// src/index.ts
import { toISODate, toMonthKey } from "./lib/dates";
import { setAuthor } from "./lib/txmeta";

/* =========================
   Roles / core types
========================= */
export type Role = "admin" | "accountant" | "staff";

export interface User {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: number;
}

export interface Session {
  userId: string;
  signedAt: number;
}

/* ============ Pricing / License ============ */
export type Plan = "trial" | "free" | "small" | "large";

export type Limits = { users: number; products: number };
export type PlanMeta = { features: string[]; limits: Limits; priceMonthlyNgn?: number };

export interface License {
  plan: Plan;
  features: string[];
  expiresAt: number;          // 0 = no expiry (free)
  lastPaymentRef?: string | null;
}

const DAY   = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

export const PLAN_META: Record<Plan, PlanMeta> = {
  free:  { features: ["core","trash","backup"], limits: { users: 1,  products: 100 } },
  trial: { features: ["core","trash","backup","export.csv","reports.plus","roles.all","bulk.tools"], limits: { users: 50, products: 50000 } },
  small: { features: ["core","trash","backup","export.csv","reports.plus"], limits: { users: 3,  products: 5000 },  priceMonthlyNgn: 2500 },
  large: { features: ["core","trash","backup","export.csv","reports.plus","roles.all","bulk.tools"], limits: { users: 50, products: 50000 }, priceMonthlyNgn: 5000 },
};

/* =========================
   Inventory / sales types
========================= */
export interface Product {
  createdBy?: { id: string; username: string; role: Role } | null;
  id: string;
  name: string;
  sku?: string;
  category?: string;
  cost_price: number;
  sell_price: number;
  qty_in_stock: number;
  alert_threshold?: number;
  createdAt: number;
}

export type NewProductInput = {
  name: string;
  sku?: string;
  category?: string;
  cost_price?: number;
  sell_price: number;
  qty_in_stock?: number;
  alert_threshold?: number;
};

export type TxKind = "income" | "expense";
export interface Transaction {
  id: string;
  kind: TxKind;
  customer_name: string | null;
  description: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  method: string | null;
  reference: string | null;
  occurred_on: string;     // "YYYY-MM-DD"
  created_at: number;

  // soft-delete metadata
  deleted_at?: number | null;
  deleted_reason?: string | null;
}

export interface Sale {
  id: string;
  sold_on: string; // "YYYY-MM-DD"
  subtotal: number;
  discount: number;
  total: number;
  method: string | null;
  created_at: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  name_snapshot: string;
  unit_price: number;
  qty: number;
  total: number;
}

/* =========================
   Storage keys
========================= */
export const KEYS = {
  users: "sp_users",
  session: "sp_session",
  license: "sp_license",
  firstRun: "sp_first_run_done",
  products: "sp_products",
  transactions: "sp_transactions",
  sales: "sp_sales",
  saleItems: "sp_sale_items",
  paidMap: "sp_paid_map",
  billing: "sp_billing_cfg",   // payment page URLs (optional)
} as const;

/* =========================
   Utils
========================= */
export function uid(): string {
  // @ts-ignore
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    // @ts-ignore
    return (crypto as any).randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

export function readJSON<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
export function writeJSON<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * signalChange
 * - writes __sp_changed__ to localStorage (useful for *other* tabs)
 * - calls in-memory subscribers (for same-tab reactive updates)
 * - dispatches a CustomEvent('sp:changed') on window for components listening to DOM events
 */
const _subscribers: Array<() => void> = [];
export function subscribeChanges(cb: () => void): () => void {
  _subscribers.push(cb);
  return () => {
    const idx = _subscribers.indexOf(cb);
    if (idx !== -1) _subscribers.splice(idx, 1);
  };
}
export function signalChange() {
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
  // call in-memory subscribers
  try {
    for (const s of _subscribers.slice()) {
      try { s(); } catch { /* ignore subscriber errors */ }
    }
  } catch {}
  // dispatch DOM event (helpful for components listening to window)
  try { window.dispatchEvent(new CustomEvent("sp:changed")); } catch {}
}

export function money(n: number): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `₦${n}`;
  }
}

/* =========================
   Users / Session
========================= */
export interface MinimalUser {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: number;
}

export function getUsers(): MinimalUser[] { return readJSON<MinimalUser[]>(KEYS.users, []); }
export function saveUsers(list: MinimalUser[]): void { writeJSON(KEYS.users, list); signalChange(); }
export function findUser(username: string): MinimalUser | undefined {
  const u = username.trim().toLowerCase();
  return getUsers().find(x => x.username === u);
}

export function getSession(): Session | null { return readJSON<Session | null>(KEYS.session, null); }
export function setSession(s: Session | null): void {
  if (s) writeJSON(KEYS.session, s);
  else localStorage.removeItem(KEYS.session);
  signalChange();
}
export function getCurrentUser(): MinimalUser | null { const s = getSession(); if (!s) return null; return getUsers().find(u => u.id === s.userId) ?? null; }

export function getCurrentUserRole(): Role | null { const u = getCurrentUser(); return u ? u.role : null; }
export function isAdmin(): boolean { return getCurrentUserRole() === "admin"; }
export function isAccountant(): boolean { return getCurrentUserRole() === "accountant"; }
export function isStaff(): boolean { return getCurrentUserRole() === "staff"; }

export function countAdmins(): number { return getUsers().filter(u => u.role === "admin").length; }

export function adminDeleteUser(userId: string): void {
  const me = getCurrentUser();
  if (!me || me.role !== "admin") throw new Error("Only admin can delete users.");
  if (me.id === userId) throw new Error("You cannot delete yourself.");

  const all = getUsers();
  const victim = all.find(u => u.id === userId);
  if (!victim) return;

  if (victim.role === "admin" && countAdmins() <= 1) {
    throw new Error("Cannot delete the last remaining admin.");
  }

  const next = all.filter(u => u.id !== userId);
  saveUsers(next);

  const s = getSession();
  if (s && s.userId === userId) setSession(null);
}

/* =========================
   Pricing helpers
========================= */
// Map legacy plan names to current ones
function coercePlanName(p: any): Plan {
  const s = String(p || "").toLowerCase();
  if (s === "pro") return "small";
  if (s in { small:1, free:1, trial:1, large:1 }) return s as Plan;
  if (s === "enterprise") return "large";
  return "free";
}

// --- 14-day trial seed on first run
function normalizeLicense(lic: Partial<License> | null): License {
  if (!lic) {
    // seed with 14-day trial on first run
    return { plan: "trial", features: PLAN_META.trial.features, expiresAt: Date.now() + 14 * DAY, lastPaymentRef: null };
  }
  const plan = coercePlanName((lic as any).plan);
  const active = lic.expiresAt === 0 || Date.now() <= (lic.expiresAt ?? 0);
  const effective = active ? plan : "free";
  return {
    plan: effective,
    features: (PLAN_META as any)[effective]?.features ?? PLAN_META.free.features,
    expiresAt: lic.expiresAt ?? 0,
    lastPaymentRef: lic.lastPaymentRef ?? null,
  };
}

export function getLicense(): License {
  const raw = readJSON<License | null>(KEYS.license, null);
  const lic = normalizeLicense(raw);
  if (!raw) writeJSON(KEYS.license, lic);
  return lic;
}
export function setLicense(lic: License): void { writeJSON(KEYS.license, normalizeLicense(lic)); signalChange(); }
export function can(feature: string, lic: License = getLicense()): boolean {
  const active = lic.expiresAt === 0 || Date.now() <= lic.expiresAt;
  const plan = active ? lic.plan : "free";
  return PLAN_META[plan].features.includes(feature);
}
export function limits(lic: License = getLicense()): Limits {
  const active = lic.expiresAt === 0 || Date.now() <= lic.expiresAt;
  const plan = active ? lic.plan : "free";
  return PLAN_META[plan].limits;
}
export function daysLeft(lic: License = getLicense()): number {
  if (lic.expiresAt === 0) return Infinity;
  return Math.ceil((lic.expiresAt - Date.now()) / DAY);
}

/**
 * isReadOnly
 * - returns true when the current license is expired (billing past due)
 * - returns false for free / active trial / active paid plans
 */
export function isReadOnly(lic: License = getLicense()): boolean {
  if (!lic) lic = getLicense();
  if (lic.expiresAt === 0) return false;
  return Date.now() > lic.expiresAt;
}

/** Pay early or renew: extends from max(now, current expiry). */
export function activatePaid(plan: "small" | "large" | "pro" | "enterprise", months = 1, paymentRef?: string): License {
  const current = getLicense();
  const anchor = Math.max(Date.now(), current.expiresAt || 0);
  const coercedPlan = coercePlanName(plan);
  const next: License = {
    plan: coercedPlan,
    features: PLAN_META[coercedPlan].features,
    expiresAt: anchor + months * MONTH,
    lastPaymentRef: paymentRef || null,
  };
  setLicense(next);
  return next;
}
export function downgradeToFree(): License {
  const next: License = { plan: "free", features: PLAN_META.free.features, expiresAt: 0, lastPaymentRef: null };
  setLicense(next);
  return next;
}

/* ---- Feature gates (UI + data-layer can use these) ---- */
export function hasFeature(feature: string, lic: License = getLicense()): boolean {
  return can(feature, lic);
}
export function requireFeature(feature: string, lic: License = getLicense()): void {
  if (!can(feature, lic)) throw new Error("Upgrade required");
}

/* ---- DEV helper to flip plan/expiry instantly (use from Settings dev block) ---- */
export function setLicenseDev(plan: Plan, daysLeftOverride?: number): License {
  const now = Date.now();
  const expiresAt =
    plan === "free" ? 0 :
    typeof daysLeftOverride === "number"
      ? now + daysLeftOverride * DAY
      : now + 14 * DAY;

  const coercedPlan = coercePlanName(plan);
  const next: License = {
    plan: coercedPlan,
    features: PLAN_META[coercedPlan].features,
    expiresAt,
    lastPaymentRef: plan === "free" ? null : "DEV-SET",
  };
  setLicense(next);
  return next;
}

/* Optional: store payment page URLs to open for Pay Now buttons */
export type BillingConfig = { smallUrl?: string; largeUrl?: string };
export function getBillingConfig(): BillingConfig { return readJSON<BillingConfig>(KEYS.billing, {}); }
export function setBillingConfig(cfg: BillingConfig) { writeJSON(KEYS.billing, cfg); signalChange(); }

/* =========================
   Backend payment helpers
========================= */
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ||
  "http://localhost:4000";

type InitResponse = {
  status?: boolean;
  message?: string;
  data?: { authorization_url?: string; access_code?: string; reference?: string; amount?: number; plan?: string };
};

export async function payInitOneTime(email: string, amountKobo: number): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/paystack/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, amount: amountKobo }),
  });
  const data = (await r.json()) as InitResponse;
  if (!r.ok || !data?.data?.authorization_url) {
    throw new Error(data?.message || "Failed to initialize payment");
  }
  return data.data.authorization_url!;
}

export async function payInitPlan(email: string, planCode: string): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/paystack/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, plan: planCode }),
  });
  const data = (await r.json()) as InitResponse;
  if (!r.ok || !data?.data?.authorization_url) {
    throw new Error(data?.message || "Failed to initialize plan");
  }
  return data.data.authorization_url!;
}

export async function verifyPaymentAndActivate(reference: string): Promise<License> {
  const r = await fetch(`${BACKEND_URL}/paystack/verify?reference=${encodeURIComponent(reference)}`);
  const data = await r.json();
  if (!r.ok || !data?.ok) throw new Error("Payment verification failed");

  const amount: number = Number(data.amount || 0); // kobo
  const planCode: string | null = data.plan || null;

  // Map to our plans: plan codes mean subscription, else use amount (kobo)
  let chosen: "small" | "large" | null = null;
  if (planCode) {
    // Customize mapping by plan code if needed
    chosen = "small"; // default for subs unless you branch by code
  } else {
    if (amount === 250000) chosen = "small";
    else if (amount === 500000) chosen = "large";
  }
  if (!chosen) throw new Error("Unknown plan or amount");

  return activatePaid(chosen, 1, data.reference);
}

/* =========================
   Auth helpers
========================= */
export async function createUser(username: string, password: string, role: Role): Promise<MinimalUser> {
  // plan limit: check users, not products
  if (getUsers().length >= limits().users) throw new Error("User limit reached for your plan. Please upgrade.");

  const u = username.trim().toLowerCase();
  if (!u) throw new Error("Username required");
  if (!password) throw new Error("Password/PIN required");
  if (findUser(u)) throw new Error("Username already exists");
  const user: MinimalUser = {
    id: uid(),
    username: u,
    role,
    passwordHash: await sha256Hex(password),
    createdAt: Date.now(),
  };
  const list = getUsers();
  list.push(user);
  saveUsers(list);
  return user;
}
export async function login(username: string, password: string): Promise<MinimalUser> {
  const user = findUser(username);
  if (!user) throw new Error("User not found");
  const hash = await sha256Hex(password);
  if (hash !== user.passwordHash) throw new Error("Invalid credentials");
  setSession({ userId: user.id, signedAt: Date.now() });
  return user;
}
export function logout(): void { setSession(null); }

export function isFirstRun(): boolean { return !localStorage.getItem(KEYS.firstRun); }
export function ensureFirstRun(): { firstRun: boolean; userCount: number } {
  const users = getUsers();
  const firstRun = users.length === 0 && isFirstRun();
  if (firstRun) {
    localStorage.setItem(KEYS.firstRun, "1");
    getLicense(); // ensure license exists (seeds 14-day trial)
  }
  return { firstRun, userCount: users.length };
}

/* =========================
   Products
========================= */
export function getProducts(): Product[] { return readJSON<Product[]>(KEYS.products, []); }
export function saveProducts(list: Product[]): void { writeJSON(KEYS.products, list); signalChange(); }

export function addProduct(input: NewProductInput): Product {
  if (getProducts().length >= limits().products) throw new Error("Product limit reached for your plan. Please upgrade.");

  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Product name is required");
  const sell = Number(input.sell_price ?? 0);
  if (!Number.isFinite(sell) || sell <= 0) throw new Error("Valid sell price required");

  const currentUser = getCurrentUser();

  const prod: Product = {
    id: uid(),
    name,
    sku: input.sku?.trim() || undefined,
    category: input.category?.trim() || undefined,
    cost_price: Number(input.cost_price ?? 0) || 0,
    sell_price: sell,
    qty_in_stock: Number(input.qty_in_stock ?? 0) || 0,
    alert_threshold: Number(input.alert_threshold ?? 0) || 0,
    createdAt: Date.now(),
    createdBy: currentUser ? { id: currentUser.id, username: currentUser.username, role: currentUser.role } : null,
  };
  const list = getProducts();
  list.push(prod);
  saveProducts(list);
  return prod;
}

export function updateProductQty(productId: string, delta: number): void {
  const list = getProducts();
  const idx = list.findIndex(p => p.id === productId);
  if (idx === -1) throw new Error("Product not found");
  const next = { ...list[idx], qty_in_stock: Math.max(0, (list[idx].qty_in_stock ?? 0) + delta) };
  list[idx] = next;
  saveProducts(list);
}

/** Admin-only: delete a product (blocked if it has sales history). */
export function deleteProduct(productId: string): void {
  const me = getCurrentUser();
  if (!me || me.role !== "admin") throw new Error("Only admin can delete products.");

  const hasHistory = getSaleItems().some(si => si.product_id === productId);
  if (hasHistory) throw new Error("Product cannot be deleted because it has sales history.");

  const list = getProducts();
  const next = list.filter(p => p.id !== productId);
  if (next.length === list.length) return;
  saveProducts(next);
}

/* =========================
   Transactions (soft delete)
========================= */
export function getTransactions(): Transaction[] { return readJSON<Transaction[]>(KEYS.transactions, []); }
export function saveTransactions(list: Transaction[]): void { writeJSON(KEYS.transactions, list); signalChange(); }

export function addTransaction(tx: Omit<Transaction, "id" | "created_at" | "deleted_at" | "deleted_reason">): Transaction {
  const amt = Number(tx.amount ?? 0);
  if (!Number.isFinite(amt) || amt < 0) throw new Error("Valid amount required");
  const payload: Transaction = { ...tx, id: uid(), created_at: Date.now(), deleted_at: null, deleted_reason: null };
  const list = getTransactions(); list.push(payload); saveTransactions(list);
  try { const u = getCurrentUser(); if (u) setAuthor(payload.id, u.id); } catch {}
  return payload;
}

export function deleteTransaction(id: string, reason = "user-delete"): void {
  const list = getTransactions();
  const idx = list.findIndex(t => t.id === id);
  if (idx === -1) return;

  list[idx] = { ...list[idx], deleted_at: Date.now(), deleted_reason: reason || null };
  saveTransactions(list);

  const map = getPaidMap();
  if (Object.prototype.hasOwnProperty.call(map, id)) {
    delete map[id]; writeJSON(KEYS.paidMap, map); signalChange();
  }
}
export function restoreTransaction(id: string): void {
  const list = getTransactions();
  const idx = list.findIndex(t => t.id === id);
  if (idx === -1 || !list[idx].deleted_at) return;
  list[idx] = { ...list[idx], deleted_at: null, deleted_reason: null };
  saveTransactions(list);
}
export function purgeDeletedTransaction(id: string): void {
  const list = getTransactions();
  const idx = list.findIndex(t => t.id === id);
  if (idx === -1) return;
  const t = list[idx];
  if (!t.deleted_at) throw new Error("Can only purge a deleted transaction.");
  saveTransactions(list.filter(x => x.id !== id));
}
export function getDeletedTransactions(): Transaction[] {
  return getTransactions().filter(t => !!t.deleted_at).sort((a,b)=>(b.deleted_at||0)-(a.deleted_at||0));
}
export function purgeAllDeletedTransactions(): void {
  const next = getTransactions().filter(t => !t.deleted_at);
  saveTransactions(next);
}
export function getTransactionsForDay(dateISO: string): Transaction[] {
  return getTransactions().filter(t => !t.deleted_at && toISODate(t.occurred_on) === dateISO).sort((a,b)=>b.created_at-a.created_at);
}
export function getTransactionsForMonth(month: string): Transaction[] {
  return getTransactions().filter(t => !t.deleted_at && toMonthKey(t.occurred_on) === month).sort((a,b)=>b.created_at-a.created_at);
}

/* =========================
   Sales (POS)
========================= */
export function getSales(): Sale[] { return readJSON<Sale[]>(KEYS.sales, []); }
export function getSaleItems(): SaleItem[] { return readJSON<SaleItem[]>(KEYS.saleItems, []); }
export function saveSales(list: Sale[]): void { writeJSON(KEYS.sales, list); signalChange(); }
export function saveSaleItems(list: SaleItem[]): void { writeJSON(KEYS.saleItems, list); signalChange(); }

export function getSalesForMonth(month: string): Sale[] {
  return getSales().filter(s => toMonthKey(s.sold_on) === month);
}

export function deleteSale(saleId: string): void {
  const me = getCurrentUser();
  if (!me || me.role !== "admin") throw new Error("Only admin can delete sales.");

  const sales = getSales();
  if (!sales.some(s => s.id === saleId)) return;

  saveSales(sales.filter(s => s.id !== saleId));

  const items = getSaleItems();
  const affected = items.filter(it => it.sale_id === saleId);
  const remain   = items.filter(it => it.sale_id !== saleId);

  const prods = getProducts();
  for (const it of affected) {
    const idx = prods.findIndex(p => p.id === it.product_id);
    if (idx !== -1) {
      prods[idx] = { ...prods[idx], qty_in_stock: Math.max(0, (prods[idx].qty_in_stock ?? 0) + (it.qty || 0)) };
    }
  }
  saveSaleItems(remain);
  saveProducts(prods);
}

/* Paid map (quick sales UI) */
export function getPaidMap(): Record<string, boolean> { return readJSON<Record<string, boolean>>(KEYS.paidMap, {}); }
export function setPaidFlag(id: string, paid: boolean): void {
  const m = getPaidMap(); m[id] = paid; writeJSON(KEYS.paidMap, m); signalChange();
}

/* Checkout */
export type CartItem = { product: Product; qty: number; price?: number };
export function checkout(cart: CartItem[], discount: number, method: string | null, soldOn: string): Sale {
  if (!cart.length) throw new Error("Cart is empty");
  const clean = cart.map(ci => ({
    product: ci.product,
    qty: Math.max(1, Math.floor(ci.qty || 1)),
    price: Number.isFinite(ci.price as number) ? Number(ci.price) : ci.product.sell_price,
  }));
  const subtotal = clean.reduce((s, ci) => s + ci.qty * (ci.price as number), 0);
  const disc = Math.max(0, Number(discount || 0));
  const total = Math.max(0, subtotal - disc);
  const sale: Sale = { id: uid(), sold_on: soldOn, subtotal, discount: disc, total, method, created_at: Date.now() };
  const sales = getSales(); sales.push(sale); saveSales(sales);
  const items = getSaleItems(); const prods = getProducts();
  clean.forEach(ci => {
    const it: SaleItem = {
      id: uid(),
      sale_id: sale.id,
      product_id: ci.product.id,
      name_snapshot: ci.product.name,
      unit_price: ci.price as number,
      qty: ci.qty,
      total: (ci.price as number) * ci.qty
    };
    items.push(it);
    const idx = prods.findIndex(p => p.id === ci.product.id);
    if (idx !== -1) prods[idx] = { ...prods[idx], qty_in_stock: Math.max(0, (prods[idx].qty_in_stock ?? 0) - ci.qty) };
  });
  saveSaleItems(items); saveProducts(prods);
  return sale;
}

/* Re-export date helpers for components that import from "../../index" */
export { toISODate, toMonthKey };

/* Boot log */
(function init() {
  const { firstRun, userCount } = ensureFirstRun();
  console.log(`🚀 StockPoint core loaded. First run: ${firstRun}, users: ${userCount}`);
})();
