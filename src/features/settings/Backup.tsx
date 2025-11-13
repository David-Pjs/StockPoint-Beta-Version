import { useEffect, useState } from "react";
import { isAdmin as isAdminFn } from "../../index";

const PIN_KEY = "sp_backup_pin:v1";

// Keys included in backup — adjust for your app
const BACKUP_KEYS = [
  "sp_users:v2",
  "sp_products:v1",
  "sp_sales:v1",
  "sp_transactions:v1",
  "sp_company:v1",
  "sp_license",
  "sp_settings",
];

function isAdmin() {
  try { return isAdminFn(); } catch { return false; }
}
function getPin(): string | null {
  try { return localStorage.getItem(PIN_KEY); } catch { return null; }
}
function setPin(pin: string) {
  try {
    localStorage.setItem(PIN_KEY, pin);
    localStorage.setItem("__sp_changed__", Date.now().toString());
  } catch {}
}
function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}
function digitsOnly(s: string) {
  return s.replace(/\D+/g, "");
}

export default function Backup() {
  const [pin, setPinState] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    setPinState(getPin());
  }, []);

  function ensurePin() {
    if (!pin) {
      const p = generatePin();
      setPin(p);
      setPinState(p);
      alert("Backup PIN created for this device.");
    }
  }

  function copy(text: string) {
    try { navigator.clipboard?.writeText(text); } catch {}
  }

  function exportBackup() {
    ensurePin();
    const dump: Record<string, any> = {};
    for (const k of BACKUP_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) dump[k] = v;
      } catch {}
    }
    const payload = {
      createdAt: new Date().toISOString(),
      version: 1,
      data: dump,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stockpoint-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file: File) {
    if (!pin) { setStatus("No PIN on this device. Generate a PIN first."); return; }
    if (enteredPin !== pin) { setStatus("Wrong PIN. Restore denied."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result || "{}"));
        if (!json || typeof json !== "object" || !json.data) throw new Error("Bad file.");
        const d = json.data as Record<string, string>;
        Object.keys(d).forEach((k) => {
          try { localStorage.setItem(k, d[k]); } catch {}
        });
        localStorage.setItem("__sp_changed__", Date.now().toString());
        setStatus("Restore complete. Reloading…");
        setTimeout(() => location.reload(), 500);
      } catch (e: any) {
        setStatus(e?.message || "Failed to restore file.");
      }
    };
    reader.onerror = () => setStatus("Could not read file.");
    reader.readAsText(file);
  }

  if (!isAdmin()) {
    return (
      <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)]">
        <h2 className="text-lg font-semibold">Backup</h2>
        <p className="mt-2 text-sm opacity-75">Only the admin can access backups.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl p-4 border bg-[var(--panel)] border-[var(--line)]">
      <h2 className="text-lg font-semibold">Backup & Restore (Admin)</h2>

      {/* PIN */}
      <div className="mt-3 p-3 rounded-lg border border-[var(--line)]">
        <div className="text-sm font-medium">Backup PIN</div>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <code className="px-3 py-2 rounded-lg bg-black/20">
            {pin ? (reveal ? pin : "••••••") : "—"}
          </code>
          <button
            className="px-2 py-1 rounded border border-[var(--line)] hover:bg-[var(--line)]/40"
            onClick={() => { if (!pin) ensurePin(); setReveal((v) => !v); }}
            type="button"
          >
            {reveal ? "Hide" : "Reveal"}
          </button>
          {pin && (
            <button
              className="px-2 py-1 rounded border border-[var(--line)] hover:bg-[var(--line)]/40"
              onClick={() => copy(pin)}
              type="button"
            >
              Copy
            </button>
          )}
          <button
            className="px-2 py-1 rounded border border-[var(--line)] hover:bg-[var(--line)]/40"
            onClick={() => {
              if (!confirm("Generate a new PIN? (You’ll need it to restore)")) return;
              const p = generatePin();
              setPin(p);
              setPinState(p);
              setReveal(true);
            }}
            type="button"
          >
            Regenerate
          </button>
        </div>
        <p className="mt-2 text-xs opacity-70">
          The PIN is stored locally and required to restore backups into this workspace.
        </p>
      </div>

      {/* Export */}
      <div className="mt-4 p-3 rounded-lg border border-[var(--line)]">
        <div className="text-sm font-medium">Export Backup</div>
        <p className="text-xs opacity-70">Exports key app data to a JSON file.</p>
        <button
          className="mt-2 px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50"
          onClick={exportBackup}
          type="button"
        >
          Download Backup
        </button>
      </div>

      {/* Import */}
      <div className="mt-4 p-3 rounded-lg border border-[var(--line)]">
        <div className="text-sm font-medium">Restore Backup</div>
        <p className="text-xs opacity-70">Enter your PIN and choose a backup JSON to restore.</p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <input
            className="w-40 rounded-lg px-3 py-2 bg-transparent border border-[var(--line)] outline-none text-sm"
            placeholder="Enter PIN"
            inputMode="numeric"
            pattern="\\d*"
            value={enteredPin}
            onChange={(e) => setEnteredPin(digitsOnly(e.target.value))}
          />
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
            }}
            className="text-sm"
          />
        </div>
        {status && <div className="mt-2 text-xs opacity-80">{status}</div>}
      </div>
    </section>
  );
}
