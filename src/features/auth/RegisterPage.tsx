import React, { useRef, useState } from "react";
import { createUser, setSession } from "../../index"; // existing core functions
import { importBackup } from "../../spCore";           // backup import
import { useNavigate } from "react-router-dom";

/**
 * Improved Register component — mobile + desktop friendly, accessible and production-ready UX
 * - Better validation and helpful feedback
 * - Replace native prompt() with a small modal to enter passphrase
 * - Clear restore flow with confirmation before replacing local data
 * - ARIA live regions for screen-reader friendly status messages
 */
export default function Register(): React.JSX.Element {
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Restore-specific state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showPassModal, setShowPassModal] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Accessibility: live region ref not required but helpful
  const statusId = "register-status";

  // Basic client-side validation rules
  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9._-]+$/.test(username);
  const pinValid = /^[0-9]{4,6}$/.test(pin); // 4-6 digit PIN

  async function onCreateAdmin(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setMsg(null);

    if (!usernameValid) {
      setErr("Username must be at least 3 characters and contain only letters, numbers, . _ or -");
      return;
    }
    if (!pinValid) {
      setErr("PIN must be 4 to 6 digits.");
      return;
    }

    setBusy(true);
    try {
      const u = await createUser(username.trim(), pin, "admin");
      setSession({ userId: u.id, signedAt: Date.now() });
      setMsg("Account created — redirecting...");
      // small delay for UX so user sees confirmation
      setTimeout(() => nav("/", { replace: true }), 600);
    } catch (e: any) {
      setErr(e?.message || "Failed to create account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // User picked a file; we store it and show modal for passphrase
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
    if (!passphrase) {
      setErr("Please enter the backup passphrase.");
      return;
    }
    if (!confirmReplace) {
      setErr("Please confirm you understand this will replace existing data on this device.");
      return;
    }

    setErr(null);
    setMsg(null);
    setBusy(true);

    try {
      const text = await restoreFile.text();
      // importBackup handles decryption/verification on the client or defers to spCore logic
      await importBackup(text, passphrase, "replace");
      setMsg("Backup restored successfully. Please create the first admin to continue.");
      setShowPassModal(false);
      setRestoreFile(null);
    } catch (e: any) {
      setErr(e?.message || "Restore failed — invalid passphrase or corrupted file.");
    } finally {
      setBusy(false);
    }
  }

  // Small helper to open the hidden file input
  function pickFile() {
    fileInputRef.current?.click();
  }

  return (
    <div className="min-h-[calc(100vh-56px)] px-4 py-8 flex items-start justify-center bg-slate-900">
      <div className="w-full max-w-xl rounded-2xl bg-[#0b1220] border border-[#1f2742] p-6 shadow-lg">
        <header className="mb-4">
          <h1 className="text-2xl font-extrabold sm:text-3xl text-slate-100">Create admin</h1>
          <p className="mt-1 text-sm sm:text-base text-slate-400">
            Set up the first account (admin) for this device. You can also restore a local encrypted backup.
          </p>
        </header>

        <form onSubmit={onCreateAdmin} className="grid gap-3">
          <label className="text-xs text-slate-300">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. admin"
            className="rounded-lg bg-[#071028] border border-[#1f2742] px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            aria-invalid={!usernameValid && username.length>0}
            aria-describedby={usernameValid ? undefined : "username-help"}
            required
          />
          {!usernameValid && username.length>0 && (
            <div id="username-help" className="text-xs text-amber-300">Username must be 3+ chars (letters, numbers, ., _, -).</div>
          )}

          <label className="text-xs text-slate-300">PIN</label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–6 digit PIN"
            className="rounded-lg bg-[#071028] border border-[#1f2742] px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            aria-invalid={!pinValid && pin.length>0}
            required
            minLength={4}
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
          />
          {!pinValid && pin.length>0 && (
            <div className="text-xs text-amber-300">PIN must be 4–6 digits.</div>
          )}

          {err && <div className="text-sm text-red-400">{err}</div>}
          {msg && <div className="text-sm text-emerald-400">{msg}</div>}

          <div className="flex gap-3 mt-1">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-4 py-2 font-medium rounded-xl bg-emerald-500 text-slate-900 disabled:opacity-60"
            >
              {busy ? "Working..." : "Create Admin"}
            </button>

            <button
              type="button"
              onClick={pickFile}
              className="px-4 py-2 rounded-xl bg-transparent border border-[#253055] text-slate-200 hover:bg-[#12203a]"
              aria-haspopup="dialog"
            >
              Restore Backup
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-[#1f2742] pt-4 text-sm text-slate-400">
          <div className="mb-2 font-medium text-slate-300">Local backup</div>
          <p className="text-xs">Keep encrypted backups (.spbak) offline. Restoring replaces current device data.</p>
        </div>

        {/* hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".spbak,application/json"
          onChange={(e) => e.target.files && onFileChosen(e.target.files[0])}
          className="hidden"
          aria-hidden
        />

        {/* Accessible live region for status updates */}
        <div id={statusId} aria-live="polite" className="sr-only">
          {busy ? 'Processing...' : msg || err || ''}
        </div>
      </div>

      {/* Passphrase / Confirm modal */}
      {showPassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-2xl bg-[#071028] border border-[#1f2742] p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-slate-100">Restore encrypted backup</h2>
            <p className="mt-1 text-sm text-slate-400">You're about to replace this device's data. This action cannot be undone locally.</p>

            <div className="grid gap-2 mt-4">
              <div>
                <label className="text-xs text-slate-300">Selected file</label>
                <div className="mt-1 text-sm text-slate-200">{restoreFile?.name || '—'}</div>
              </div>

              <label className="text-xs text-slate-300">Backup passphrase</label>
              <input
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                type="password"
                placeholder="Enter passphrase"
                className="rounded-lg bg-[#071028] border border-[#1f2742] px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                autoFocus
              />

              <label className="inline-flex items-center gap-2 mt-2">
                <input type="checkbox" checked={confirmReplace} onChange={(e)=>setConfirmReplace(e.target.checked)} className="accent-emerald-500" />
                <span className="text-xs text-slate-300">I understand this will replace local data on this device</span>
              </label>

              {err && <div className="text-sm text-red-400">{err}</div>}
              {msg && <div className="text-sm text-emerald-400">{msg}</div>}

              <div className="flex gap-2 mt-3">
                <button
                  onClick={onRestoreConfirm}
                  disabled={busy}
                  className="flex-1 px-3 py-2 font-medium text-black rounded-lg bg-amber-600 disabled:opacity-60"
                >
                  {busy ? 'Restoring...' : 'Confirm & Restore'}
                </button>
                <button
                  onClick={() => { setShowPassModal(false); setRestoreFile(null); setErr(null); setMsg(null); }}
                  className="px-3 py-2 rounded-lg border border-[#253055] text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
