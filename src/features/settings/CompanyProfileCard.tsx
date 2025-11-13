// src/features/settings/CompanyProfileCard.tsx
import { useEffect, useMemo, useState } from "react";
import { getCompany, setCompanyField, addCompanyFile, removeCompanyFile } from "../../lib/company";

type Company = ReturnType<typeof getCompany>;

// Helper: ping other tabs / panels to refresh
function pingRealtime() {
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

export default function CompanyProfileCard() {
  const [p, setP] = useState<Company>(getCompany());
  const [draft, setDraft] = useState<Company>(getCompany());
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // Re-sync when something else updates company in another tab/panel
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (!e.key || e.key === "__sp_changed__") {
        const next = getCompany();
        setP(next);
        setDraft(next);
      }
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  // Compute dirty state only for editable text fields below
  const dirty = useMemo(() => {
    const pick = (c: Company) => JSON.stringify({
      name: c.name || "",
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
    });
    return pick(p) !== pick(draft);
  }, [p, draft]);

  /* ------------------------------- file picks ------------------------------- */
  function onLogoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      setCompanyField("logo", String(r.result || ""));
      const next = getCompany();
      setP(next);
      setDraft(next); // keep draft in sync for logo
      pingRealtime();
    };
    r.readAsDataURL(f);
  }
  function onAddFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      addCompanyFile(f.name, f.type, String(r.result || ""));
      const next = getCompany();
      setP(next);
      // files do not affect dirty flag (they live outside the basic text fields)
      pingRealtime();
    };
    r.readAsDataURL(f);
  }

  /* -------------------------------- actions -------------------------------- */
  async function onSave() {
    if (!dirty) return;
    setSaving(true);
    try {
      // Persist only known editable text fields
      setCompanyField("name", draft.name || "");
      setCompanyField("email", draft.email || "");
      setCompanyField("phone", draft.phone || "");
      setCompanyField("address", draft.address || "");

      pingRealtime();

      const next = getCompany();
      setP(next);
      setDraft(next);
      setSavedMsg("Saved ✓");
      setTimeout(() => setSavedMsg(""), 2000);
    } finally {
      setSaving(false);
    }
  }

  function onReset() {
    setDraft(p);
  }

  /* ---------------------------------- UI ----------------------------------- */
  return (
    <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">Company profile</h3>
        {savedMsg && <span className="text-xs opacity-80">{savedMsg}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block mb-1 text-sm">Name</label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
            value={draft.name || ""}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="Your Company Ltd."
          />
        </div>
        <div>
          <label className="block mb-1 text-sm">Email</label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
            value={draft.email || ""}
            onChange={e => setDraft({ ...draft, email: e.target.value })}
            placeholder="hello@yourcompany.com"
          />
        </div>
        <div>
          <label className="block mb-1 text-sm">Phone</label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
            value={draft.phone || ""}
            onChange={e => setDraft({ ...draft, phone: e.target.value })}
            placeholder="+234 812 345 6789"
          />
        </div>
        <div>
          <label className="block mb-1 text-sm">Address</label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
            value={draft.address || ""}
            onChange={e => setDraft({ ...draft, address: e.target.value })}
            placeholder="12 Adeola Rd, Ikeja, Lagos"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <div className="w-20 h-20 rounded bg-[var(--line)] overflow-hidden flex items-center justify-center">
          {p.logo ? (
            <img src={p.logo} className="object-cover w-full h-full" />
          ) : (
            <span className="text-xs opacity-60">No logo</span>
          )}
        </div>
        <label className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50 cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
          Upload logo
        </label>
        <label className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50 cursor-pointer">
          <input type="file" className="hidden" onChange={onAddFile} />
          Add file
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4">
        <button
          className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/40 disabled:opacity-50"
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/40 disabled:opacity-50"
          onClick={onReset}
          disabled={!dirty || saving}
        >
          Reset
        </button>
      </div>

      {p.files.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 font-medium">Files</h4>
          <div className="grid gap-2">
            {p.files.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-2 border border-[var(--line)] rounded-lg px-3 py-2"
              >
                <div className="text-sm">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs opacity-60">{f.type}</div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    download={f.name}
                    href={f.dataUrl}
                    className="px-2 py-1 rounded-md border border-[var(--line)] text-sm"
                  >
                    Download
                  </a>
                  <button
                    className="px-2 py-1 rounded-md border border-[var(--line)] text-sm"
                    onClick={() => {
                      removeCompanyFile(f.id);
                      const next = getCompany();
                      setP(next);
                      pingRealtime();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
