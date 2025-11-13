// src/lib/txmeta.ts
const KEY = "sp_tx_authors:v1"; // txId -> userId
type MapT = Record<string, string>;

function read(): MapT {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as MapT) : {}; }
  catch { return {}; }
}
function write(m: MapT) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

export function setAuthor(txId: string, userId: string) {
  const m = read(); m[txId] = userId; write(m);
}
export function getAuthor(txId: string): string | null {
  const m = read(); return m[txId] || null;
}
export function getAllAuthors(): MapT { return read(); }
