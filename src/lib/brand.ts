
// src/lib/brand.ts
export type Brand = { name: string; email?: string; phone?: string; address?: string; logo?: string };
const KEY = "sp.brand";

export function getBrand(): Brand {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { name: "StockPoint" };
}

export function setBrand(next: Partial<Brand>): Brand {
  const cur = getBrand();
  const out = { ...cur, ...next };
  localStorage.setItem(KEY, JSON.stringify(out));
  return out;
}
