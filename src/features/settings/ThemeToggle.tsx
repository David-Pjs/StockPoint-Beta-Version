// src/features/settings/ThemeToggle.tsx
import { useEffect, useState } from "react";

function getStoredTheme(): "light" | "dark" {
  try { return (localStorage.getItem("sp_theme") as any) || "dark"; } catch { return "dark"; }
}
function applyTheme(t: "light" | "dark") {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("sp_theme", t); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

export default function ThemeToggle() {
  const [t, setT] = useState<"light" | "dark">(getStoredTheme());
  useEffect(() => { applyTheme(t); }, [t]);

  return (
    <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <h3 className="text-lg font-semibold mb-2">Appearance</h3>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <input type="radio" checked={t==="light"} onChange={()=>setT("light")} /> Light
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={t==="dark"} onChange={()=>setT("dark")} /> Dark
        </label>
      </div>
    </div>
  );
}
