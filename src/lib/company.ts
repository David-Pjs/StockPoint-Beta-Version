// src/lib/company.ts
export type CompanyFile = { id: string; name: string; type: string; dataUrl: string; createdAt: number };
export type CompanyProfile = {
  name?: string; address?: string; phone?: string; email?: string;
  logo?: string | null; // dataURL
  files: CompanyFile[];
};

const KEY = "sp_company_profile:v1";

function read(): CompanyProfile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CompanyProfile) : { files: [] };
  } catch { return { files: [] }; }
}
function write(p: CompanyProfile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

export function getCompany(): CompanyProfile { return read(); }
export function saveCompany(p: CompanyProfile) { write(p); }
export function setCompanyField<K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) {
  const p = read(); (p as any)[k] = v; write(p);
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export function addCompanyFile(name: string, type: string, dataUrl: string): CompanyFile {
  const p = read();
  const file: CompanyFile = { id: uid(), name, type, dataUrl, createdAt: Date.now() };
  p.files.unshift(file);
  write(p); return file;
}
export function removeCompanyFile(id: string) {
  const p = read(); p.files = p.files.filter(f => f.id !== id); write(p);
}
