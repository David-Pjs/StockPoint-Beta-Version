// src/spCore.ts
// Offline, date-safe core for StockPoint
// - Soft delete (Trash)
// - Encrypted backups (.spbak)
// - CSV export helpers

export type TxKind = "income" | "expense";

export type Transaction = {
  id: string;
  kind: TxKind;
  customer_name: string | null;
  description: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  method: string | null;
  reference: string | null;
  occurred_on: string;   // "YYYY-MM-DD" local day
  created_at: number;    // ms epoch
  deleted_at?: number | null;
  deleted_reason?: string | null;
};

const TX_KEY   = "sp_tx:v2";
const PAID_KEY = "sp_paid:v1";
const BUS_KEY  = "__sp_changed__"; // heartbeat for realtime

/* ---------------- utils ---------------- */
function safeParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function ymdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toLocalYMDFromISO(iso: string): string { return ymdFromLocalDate(new Date(iso)); }
function pulse() { try { localStorage.setItem(BUS_KEY, String(Date.now())); } catch {} }
function makeId() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/* ---------------- one-time migration ---------------- */
(function migrate() {
  const list = safeParse<Transaction[]>(localStorage.getItem(TX_KEY), []);
  let changed = false;
  for (const t of list) {
    if (typeof t.occurred_on === "string" && t.occurred_on.includes("T")) {
      t.occurred_on = toLocalYMDFromISO(t.occurred_on);
      changed = true;
    }
    if (typeof (t as any).created_at === "string") {
      const n = Date.parse((t as any).created_at);
      if (!Number.isNaN(n)) { (t as any).created_at = n; changed = true; }
    }
  }
  if (changed) localStorage.setItem(TX_KEY, JSON.stringify(list));
})();

/* ---------------- internals ---------------- */
function getAll(): Transaction[] {
  return safeParse<Transaction[]>(localStorage.getItem(TX_KEY), []);
}
function setAll(list: Transaction[]) {
  localStorage.setItem(TX_KEY, JSON.stringify(list));
  pulse();
}

/* ---------------- helpers ---------------- */
export function money(n: number): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(n);
  } catch { return "₦" + (Math.round(n * 100) / 100).toFixed(2); }
}
export function isAdmin(): boolean {
  const role = localStorage.getItem("sp_role");
  return role ? role === "admin" : true; // dev default
}
export function getPaidMap(): Record<string, boolean> {
  return safeParse<Record<string, boolean>>(localStorage.getItem(PAID_KEY), {});
}
function setPaidMap(map: Record<string, boolean>) {
  localStorage.setItem(PAID_KEY, JSON.stringify(map));
  pulse();
}

/* ---------------- transactions API ---------------- */
export function addTransaction(tx: Omit<Transaction, "id" | "created_at" | "deleted_at" | "deleted_reason">) {
  const item: Transaction = { ...tx, id: makeId(), created_at: Date.now(), deleted_at: null, deleted_reason: null };
  const list = getAll(); list.push(item); setAll(list); return item.id;
}
export function getTransactionsForDay(dayISO: string): Transaction[] {
  return getAll().filter(t => !t.deleted_at && t.occurred_on === dayISO).sort((a,b)=>a.created_at-b.created_at);
}
export function getTransactionsForMonth(monthYYYYMM: string): Transaction[] {
  return getAll().filter(t => !t.deleted_at && t.occurred_on.slice(0,7) === monthYYYYMM).sort((a,b)=>a.created_at-b.created_at);
}
export function setPaidFlag(id: string, paid: boolean) { const m = getPaidMap(); m[id]=paid; setPaidMap(m); }
export function deleteTransaction(id: string, reason = "user-delete") {
  const list = getAll(); const idx = list.findIndex(t => t.id===id); if (idx===-1) return;
  list[idx] = { ...list[idx], deleted_at: Date.now(), deleted_reason: reason || null }; setAll(list);
  const m = getPaidMap(); if (m[id] !== undefined) { delete m[id]; setPaidMap(m); }
}
export function restoreTransaction(id: string) {
  const list = getAll(); const idx = list.findIndex(t => t.id===id); if (idx===-1 || !list[idx].deleted_at) return;
  list[idx] = { ...list[idx], deleted_at: null, deleted_reason: null }; setAll(list);
}
export function getDeletedTransactions(): Transaction[] {
  return getAll().filter(t => !!t.deleted_at).sort((a,b)=>(b.deleted_at||0)-(a.deleted_at||0));
}
export function purgeDeletedTransaction(id: string) {
  const list = getAll(); const idx = list.findIndex(t => t.id===id); if (idx===-1) return;
  if (!list[idx].deleted_at) throw new Error("Can only purge a deleted transaction.");
  setAll(list.filter(t => t.id!==id));
}
export function purgeAllDeletedTransactions() { setAll(getAll().filter(t=>!t.deleted_at)); }

/* ---------------- today helper ---------------- */
export function todayISO(): string { return ymdFromLocalDate(new Date()); }

/* ======================================================================== */
/* ===================  BACKUP / RESTORE (encrypted)  ===================== */
/* ======================================================================== */

type BackupEnvelope = {
  app: "StockPoint";
  version: 2;
  createdAt: number;
  // metadata for the KDF and cipher
  kdf: { alg: "PBKDF2"; hash: "SHA-256"; saltB64: string; iterations: number };
  cipher: { alg: "AES-GCM"; ivB64: string };
  // verification
  plaintextSha256: string; // hex of SHA-256 over the plaintext JSON
  // ciphertext
  dataB64: string;
};

// Collect all app data (except volatile/session)
function collectAppData(): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!; if (!k) continue;
    if (/^sp[_:]/i.test(k) && k !== "sp_session" && k !== "__sp_changed__") {
      const v = localStorage.getItem(k); if (v != null) obj[k] = v;
    }
  }
  return obj;
}

function clearAppData() {
  const toDel: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!; if (!k) continue;
    if (/^sp[_:]/i.test(k) || k === "__sp_changed__") toDel.push(k);
  }
  toDel.forEach(k => localStorage.removeItem(k));
  pulse();
}
export function resetDeviceData() { clearAppData(); } // exported for Settings

// basic encoders
const te = new TextEncoder(); const td = new TextDecoder();
const b64 = {
  enc: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (b: string) => Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer,
};
async function sha256Hex(s: string) {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(s));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function deriveKey(pass: string, salt: ArrayBuffer, iterations = 120_000) {
  const baseKey = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", hash:"SHA-256", salt, iterations },
    baseKey,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Create an encrypted .spbak string (JSON). */
export async function exportBackup(passphrase: string): Promise<string> {
  if (!passphrase || passphrase.length < 4) throw new Error("Passphrase required (min 4 chars).");

  const plain = JSON.stringify({ data: collectAppData() });
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const iv   = crypto.getRandomValues(new Uint8Array(12)).buffer;
  const key  = await deriveKey(passphrase, salt);
  const ct   = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, te.encode(plain));
  const env: BackupEnvelope = {
    app: "StockPoint",
    version: 2,
    createdAt: Date.now(),
    kdf: { alg:"PBKDF2", hash:"SHA-256", saltB64: b64.enc(salt), iterations: 120_000 },
    cipher: { alg:"AES-GCM", ivB64: b64.enc(iv) },
    plaintextSha256: await sha256Hex(plain),
    dataB64: b64.enc(ct),
  };
  return JSON.stringify(env);
}

/** Import an encrypted .spbak string. mode: "replace" (default) or "merge". */
export async function importBackup(payload: string, passphrase: string, mode: "replace"|"merge" = "replace") {
  const env = safeParse<BackupEnvelope>(payload, null as any);
  if (!env || env.app !== "StockPoint" || env.version !== 2) throw new Error("Invalid backup file.");
  const salt = b64.dec(env.kdf.saltB64); const iv = b64.dec(env.cipher.ivB64);
  const key = await deriveKey(passphrase, salt, env.kdf.iterations);
  let plaintext: string;
  try {
    const pt = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, b64.dec(env.dataB64));
    plaintext = td.decode(pt);
  } catch { throw new Error("Wrong passphrase."); }
  const hash = await sha256Hex(plaintext);
  if (hash !== env.plaintextSha256) throw new Error("Backup corrupted (hash mismatch).");

  const obj = safeParse<{ data: Record<string,string> }>(plaintext, { data:{} });
  if (mode === "replace") clearAppData();
  for (const [k, v] of Object.entries(obj.data)) localStorage.setItem(k, v);
  pulse();
  return { restoredKeys: Object.keys(obj.data).length, mode };
}

/* ---------------- CSV helpers (for Print/Export) ---------------- */
function toCSV(rows: (string|number)[][]): string {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

export function exportDayCSV(dayISO: string): string {
  const paid = getPaidMap();
  const head = [["Date/Time","Customer","Type","Qty","Unit Price","Amount","Description","Method","Reference","Paid"]];
  const rows = getTransactionsForDay(dayISO).map(t => [
    new Date(t.created_at).toLocaleString(),
    t.customer_name ?? "—",
    t.kind,
    t.qty,
    t.unit_price.toFixed(2),
    t.amount.toFixed(2),
    t.description ?? "—",
    t.method ?? "—",
    t.reference ?? "—",
    paid[t.id] ? "Yes" : "No",
  ]);
  return toCSV([...head, ...rows]);
}
export function exportMonthCSV(monthYYYYMM: string): string {
  const paid = getPaidMap();
  const head = [["Date","Customer","Type","Qty","Unit Price","Amount","Description","Method","Reference","Paid"]];
  const rows = getTransactionsForMonth(monthYYYYMM).map(t => [
    t.occurred_on,
    t.customer_name ?? "—",
    t.kind,
    t.qty,
    t.unit_price.toFixed(2),
    t.amount.toFixed(2),
    t.description ?? "—",
    t.method ?? "—",
    t.reference ?? "—",
    paid[t.id] ? "Yes" : "No",
  ]);
  return toCSV([...head, ...rows]);
}
