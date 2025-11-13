// src/security.ts
// PBKDF2 hashing, throttling, idle lock helpers (no deps, works offline)

export type PBKDF2Hash = {
  algo: 'pbkdf2';
  v: 1;
  iterations: number;
  saltB64: string;
  hashB64: string;
};

export type LegacyHash = { algo: 'sha256-hex'; hash: string };
export type AnyHash = PBKDF2Hash | LegacyHash;

const ITERATIONS = 150_000;

// ---------- utils ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  u8.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// ---------- hashing ----------
export async function makePBKDF2(secret: string): Promise<PBKDF2Hash> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    256
  );
  return {
    algo: 'pbkdf2',
    v: 1,
    iterations: ITERATIONS,
    saltB64: b64(salt),
    hashB64: b64(new Uint8Array(bits)),
  };
}

export async function verifyPBKDF2(secret: string, rec: PBKDF2Hash): Promise<boolean> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const salt = fromB64(rec.saltB64);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: rec.iterations, hash: 'SHA-256' },
    base,
    256
  );
  const cmp = b64(new Uint8Array(bits));
  // Constant-time comparison to prevent timing attacks
  const a = enc.encode(cmp);
  const b = enc.encode(rec.hashB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Legacy (kept for lazy migration)
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- throttling (per user) ----------
export function throttleDelayMs(userId: string): number {
  const k = `sp_login:${userId}`;
  const rec = JSON.parse(localStorage.getItem(k) || '{"n":0,"until":0}');
  const now = Date.now();
  if (now < rec.until) return rec.until - now;
  return 0;
}
export function recordFail(userId: string) {
  const k = `sp_login:${userId}`;
  const r = JSON.parse(localStorage.getItem(k) || '{"n":0,"until":0}');
  const n = Math.min(r.n + 1, 10);
  const delay = Math.min(2 ** n * 250, 60_000);
  localStorage.setItem(k, JSON.stringify({ n, until: Date.now() + delay }));
}
export function recordSuccess(userId: string) {
  localStorage.removeItem(`sp_login:${userId}`);
}

// ---------- idle lock ----------
let idleTimer: number | null = null;
const IDLE_MS = 3 * 60 * 1000; // 3 minutes

export function startIdleWatch(onLock: () => void) {
  const reset = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onLock, IDLE_MS) as unknown as number;
  };
  ['mousemove','keydown','click','touchstart','scroll','visibilitychange'].forEach(ev =>
    window.addEventListener(ev, reset, { passive: true })
  );
  window.addEventListener('blur', reset);
  reset();
  return () => {
    ['mousemove','keydown','click','touchstart','scroll','visibilitychange'].forEach(ev =>
      window.removeEventListener(ev, reset)
    );
    window.removeEventListener('blur', reset);
    if (idleTimer) clearTimeout(idleTimer);
  };
}
