// src/lib/backup.ts
// Encrypted backup/restore for all StockPoint localStorage keys.

const BACKUP_NAME = (stamp = new Date()) =>
  `stockpoint-${stamp.toISOString().replace(/[:T]/g, "-").slice(0, 16)}.spbak`;

const ITERATIONS = 150_000; // PBKDF2 cost (ok for testing; increase if you want more work)
const TEXT = new TextEncoder();
const BIN = new TextDecoder();

/** include only app keys */
function shouldInclude(key: string) {
  if (!key || !key.startsWith("sp_")) return false;
  return key !== "sp_session" && key !== "__sp_changed__";
}

/** Collect → JSON string */
function snapshot(): string {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (shouldInclude(k)) {
      const v = localStorage.getItem(k);
      if (v != null) data[k] = v;
    }
  }
  return JSON.stringify({ v: 1, createdAt: Date.now(), data });
}

/** Write keys back */
function restoreFrom(json: string, mode: "replace" | "merge" = "replace") {
  const parsed = JSON.parse(json) as { v: number; data: Record<string, string> };
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1 || !parsed.data) {
    throw new Error("Invalid backup payload.");
  }
  const { data } = parsed;

  if (mode === "replace") {
    // Wipe **only** the app keys we manage.
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (shouldInclude(k)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  }

  for (const [k, v] of Object.entries<string>(data)) {
    localStorage.setItem(k, v);
  }
  try {
    localStorage.setItem("__sp_changed__", String(Date.now()));
  } catch {}
}

/* ---------- crypto helpers (PBKDF2 + AES-GCM) ---------- */

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  // import passphrase material (raw)
  const passRaw = TEXT.encode(passphrase) as BufferSource;
  const material = await crypto.subtle.importKey(
    "raw",
    passRaw,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // derive AES-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toU8(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

const b64 = {
  enc: (buf: ArrayBuffer | Uint8Array) => {
    const u8 = toU8(buf);
    // convert to binary string in chunks (avoid large strings)
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  },
  dec: (str: string) => {
    const bin = atob(str);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  },
};

/* ---------- public API ---------- */

/**
 * Export a backup blob encrypted with the provided passphrase.
 * Returns an object with filename and blob ready to download.
 */
export async function exportBackup(passphrase: string): Promise<{ filename: string; blob: Blob }> {
  if (!passphrase || passphrase.length < 4) throw new Error("Passphrase required (≥4 chars).");

  const plainU8 = TEXT.encode(snapshot()); // Uint8Array
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKey(passphrase, salt);

  // encrypt expects BufferSource; pass plainU8.buffer (ArrayBuffer) or the view as BufferSource
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plainU8 as BufferSource
  );

  const payload = JSON.stringify({
    v: 1,
    alg: "PBKDF2-AES-GCM",
    kdf: { iterations: ITERATIONS, salt: b64.enc(salt) },
    iv: b64.enc(iv),
    cipher: b64.enc(cipherBuf),
  });

  return { filename: BACKUP_NAME(), blob: new Blob([payload], { type: "application/octet-stream" }) };
}

/**
 * Import a .spbak File, decrypt with passphrase and restore to localStorage.
 * mode: "replace" wipes existing app keys before restoring; "merge" keeps existing keys.
 */
export async function importBackup(
  file: File,
  passphrase: string,
  mode: "replace" | "merge" = "replace"
): Promise<void> {
  if (!file) throw new Error("Select a .spbak file.");
  if (!passphrase || passphrase.length < 4) throw new Error("Passphrase required (≥4 chars).");

  const text = await file.text();
  let obj: any;
  try { obj = JSON.parse(text); } catch { throw new Error("Invalid backup file (not JSON)."); }

  if (!obj || obj.v !== 1 || obj.alg !== "PBKDF2-AES-GCM") {
    throw new Error("Invalid backup file format.");
  }

  const saltU8 = b64.dec(obj.kdf?.salt || "");
  const ivU8 = b64.dec(obj.iv || "");
  const cipherU8 = b64.dec(obj.cipher || "");

  const key = await deriveKey(passphrase, saltU8);

  let plainBuf: ArrayBuffer;
  try {
    // crypto.subtle.decrypt accepts ArrayBuffer or ArrayBufferView (BufferSource)
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivU8 as BufferSource },
      key,
      cipherU8 as BufferSource
    );
  } catch (err) {
    throw new Error("Wrong passphrase or corrupted file.");
  }

  const plainText = BIN.decode(new Uint8Array(plainBuf));
  restoreFrom(plainText, mode);
}
