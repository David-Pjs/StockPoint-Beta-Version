import React, { useRef, useState } from "react";
import { createUser, setSession } from "../../index";
import { importBackup } from "../../spCore";
import { useNavigate } from "react-router-dom";

export default function Register(): React.JSX.Element {
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showPassModal, setShowPassModal] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9._-]+$/.test(username);
  const pinValid = /^[0-9]{4,6}$/.test(pin);

  async function onCreateAdmin(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setMsg(null);

    if (!usernameValid) return setErr("Name must be at least 3 characters (letters, numbers, . _ - allowed).");
    if (!pinValid) return setErr("PIN must be 4–6 digits.");

    setBusy(true);
    try {
      const u = await createUser(username.trim(), pin, "admin");
      // set session for this device
      setSession({ userId: u.id, signedAt: Date.now() });
      // after creating an admin, immediately go to organize business step
      nav("/organize");
    } catch (e: any) {
      setErr(e?.message || "Failed to create account.");
    } finally {
      setBusy(false);
    }
  }

  function onFileChosen(file?: File) {
    setErr(null);
    setMsg(null);
    setRestoreFile(file || null);
    if (file) {
      setShowPassModal(true);
      setPassphrase("");
      setConfirmReplace(false);
    }
  }

  async function onRestoreConfirm() {
    if (!restoreFile) return;
    if (!passphrase) return setErr("Enter the backup passphrase.");
    if (!confirmReplace) return setErr("Confirm that you understand data will be replaced.");

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const text = await restoreFile.text();
      await importBackup(text, passphrase, "replace");
      setMsg("Backup restored. Please create an admin.");
      setShowPassModal(false);
      setRestoreFile(null);
    } catch (e: any) {
      setErr(e?.message || "Restore failed — invalid passphrase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[var(--bg)]">
      <div className="w-full max-w-xl bg-[var(--panel)] border border-[var(--line)] rounded-2xl shadow-xl p-8">

        {/* HEADER */}
        <h1 className="text-3xl font-extrabold text-[var(--ink)]">Create Admin</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">This is the main account for this device.</p>

        {/* FORM */}
        <form onSubmit={onCreateAdmin} className="flex flex-col gap-5 mt-6">
          <div>
            <label className="text-sm font-semibold text-[var(--ink)]">Full Name</label>
            <input className="mt-2 control" placeholder="e.g. John Store" value={username} onChange={(e) => setUsername(e.target.value)} />
            <div className="mt-1 text-[var(--muted)] text-xs">Enter your full name clearly</div>
          </div>

          <div>
            <label className="text-sm font-semibold text-[var(--ink)]">PIN</label>
            <input type="password" className="mt-2 control" placeholder="4–6 digit PIN" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>

          {err && <div className="text-sm text-red-500">{err}</div>}
          {msg && <div className="text-sm text-green-500">{msg}</div>}

          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="flex-1 btn">
              {busy ? "Working..." : "Continue"}
            </button>

            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 btn-ghost">
              Restore Backup
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
          <div className="mb-1 text-[var(--ink)] font-semibold">Local Backup</div>
          <p className="text-xs">Keep encrypted backups safely. Restoring replaces all data.</p>
        </div>

        <input ref={fileInputRef} type="file" accept=".spbak,application/json" onChange={(e) => e.target.files && onFileChosen(e.target.files[0])} className="hidden" />

        {/* RESTORE MODAL */}
        {showPassModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-[var(--panel)] border border-[var(--line)] p-6 rounded-2xl w-full max-w-md shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Restore Encrypted Backup</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Restoring will replace all data on this device.</p>

              <div className="flex flex-col gap-4 mt-4">
                <div>
                  <label className="text-sm text-[var(--ink)]">Selected File</label>
                  <div className="mt-1 text-[var(--ink)] text-sm">{restoreFile?.name}</div>
                </div>

                <div>
                  <label className="text-sm text-[var(--ink)]">Backup Passphrase</label>
                  <input type="password" className="mt-2 control" placeholder="Enter passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                </div>

                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} className="accent-[var(--accent)]" />
                  <span className="text-xs text-[var(--ink)]">I understand this will replace all device data.</span>
                </label>

                {err && <div className="text-sm text-red-500">{err}</div>}

                <div className="flex gap-3 mt-3">
                  <button onClick={onRestoreConfirm} disabled={busy} className="flex-1 btn bg-amber-600">
                    {busy ? "Restoring..." : "Confirm & Restore"}
                  </button>

                  <button onClick={() => { setShowPassModal(false); setRestoreFile(null); setErr(null); setMsg(null); }} className="flex-1 btn-ghost">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
