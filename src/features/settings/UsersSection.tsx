// src/features/settings/UsersSection.tsx
import { useMemo, useState, type FormEvent } from "react";
import {
  createUser,
  getUsers,
  getCurrentUser,
  isAdmin,
  adminDeleteUser,
  countAdmins,
  type Role,
} from "../../index";

export default function UsersSection() {
  const me = getCurrentUser();
  const [uname, setUname] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Extract<Role, "accountant" | "staff">>("accountant");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // re-read when storage changes (simple refresh trick)
  const users = useMemo(() => getUsers(), [localStorage.getItem("sp_users")]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (!isAdmin()) return setErr("Only admin can add users.");
    try {
      await createUser(uname, pin, role);
      setUname("");
      setPin("");
      setMsg("User added.");
      setTimeout(() => location.reload(), 250);
    } catch (e: any) {
      setErr(e?.message || "Failed to add user");
    }
  }

  function onDelete(id: string) {
    setMsg(null);
    setErr(null);
    try {
      const victim = users.find(u => u.id === id);
      if (!victim) return;
      if (!confirm(`Delete ${victim.username} (${victim.role})? This cannot be undone.`)) return;
      adminDeleteUser(id);
      setMsg("User deleted.");
      setTimeout(() => location.reload(), 250);
    } catch (e: any) {
      setErr(e?.message || "Failed to delete user");
    }
  }

  const adminsLeft = countAdmins();

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <h3 className="text-lg font-semibold">Users</h3>
      <p className="text-sm text-[var(--muted)]">Admin can add or delete users. You can’t delete yourself or the last admin.</p>

      {/* Add user */}
      <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input
          className="rounded-lg bg-[var(--canvas)] border border-[var(--line)] px-3 py-2"
          placeholder="username"
          value={uname}
          onChange={(e) => setUname(e.target.value)}
          required
        />
        <input
          className="rounded-lg bg-[var(--canvas)] border border-[var(--line)] px-3 py-2"
          placeholder="pin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
          minLength={4}
        />
        <select
          className="rounded-lg bg-[var(--canvas)] border border-[var(--line)] px-3 py-2"
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
        >
          <option value="accountant">Accountant</option>
          <option value="staff">Staff</option>
        </select>
        <button className="rounded-lg px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          Add
        </button>
      </form>

      {(msg || err) && (
        <p className={`mt-2 text-sm ${err ? "text-red-400" : "text-emerald-400"}`}>
          {err || msg}
        </p>
      )}

      {/* List */}
      <div className="mt-5">
        <h4 className="font-medium mb-2">Existing users</h4>
        <ul className="divide-y divide-[var(--line)]">
          {users.map((u) => {
            const isMe = me?.id === u.id;
            const isLastAdmin = u.role === "admin" && adminsLeft <= 1;
            const canDelete = isAdmin() && !isMe && !isLastAdmin;

            return (
              <li key={u.id} className="flex items-center justify-between py-2">
                <div className="text-sm">
                  <span className="font-medium">{u.username}</span>{" "}
                  <span className="text-[var(--muted)]">• {u.role}</span>
                  {isMe && <span className="ml-2 text-sky-400 text-xs">(you)</span>}
                  {isLastAdmin && <span className="ml-2 text-amber-400 text-xs">(last admin)</span>}
                </div>

                {canDelete ? (
                  <button
                    onClick={() => onDelete(u.id)}
                    className="text-red-400 border border-red-600/50 hover:bg-red-600/10 rounded px-3 py-1 text-sm"
                    title="Delete user"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    disabled
                    className="opacity-40 cursor-not-allowed border rounded px-3 py-1 text-sm"
                    title={
                      isMe
                        ? "You can't delete yourself"
                        : isLastAdmin
                        ? "You can't delete the last admin"
                        : "Only admin can delete"
                    }
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
