// src/features/settings/TeamManager.tsx
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getUsers,
  saveUsers,
  createUser,
  getLicense,
  PLAN_META,
  type Role, // keep your global Role
} from "../../index";
import { getAvatar, setAvatar } from "../../lib/avatars";

/* ----------------------------- plan/role helpers ----------------------------- */
type AnyRole = Role | "manager" | "cashier" | string;
type NewUser = { username: string; pin: string; role: AnyRole };

function isEnterprise(plan: string) { return plan === "large"; }
function isPro(plan: string) { return plan === "small"; }
function isFreeOrTrial(plan: string) { return plan !== "small" && plan !== "large"; }

function assignableRolesForPlan(plan: string): AnyRole[] {
  if (isEnterprise(plan)) return ["manager","staff","cashier","accountant","custom…"];
  if (isPro(plan)) return ["manager","staff","cashier"];
  return [];
}
function sanitizeAssignedRole(input: AnyRole, plan: string): AnyRole {
  const r = String(input).trim();
  if (r.toLowerCase() === "admin") return isEnterprise(plan) ? "manager" : r; // block second admin
  return r || (isEnterprise(plan) ? "manager" : "staff");
}

/* ----------------------------- PIN (digits-only UX) ----------------------------- */
const PIN_MAX = 6; // tweak if you like
function digitsOnly(s: string) { return s.replace(/\D+/g, ""); }
function pinInputProps(value: string, setValue: (v: string)=>void) {
  return {
    value,
    inputMode: "numeric" as const,
    autoComplete: "one-time-code",
    pattern: "\\d*",
    maxLength: PIN_MAX,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      const k = e.key;
      const ok = /[0-9]/.test(k) || ["Backspace","Delete","Tab","ArrowLeft","ArrowRight","Home","End","Enter"].includes(k);
      if (!ok) e.preventDefault();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = digitsOnly(e.target.value).slice(0, PIN_MAX);
      setValue(next);
    }
  };
}

/* ----------------------------- tiny UI helpers ----------------------------- */
function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default"|"green"|"blue"|"amber"|"rose" }) {
  const base = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px]";
  const toneCls = {
    default: "border-[var(--line)]/60",
    green:   "border-green-500/50 text-green-400",
    blue:    "border-sky-500/50 text-sky-400",
    amber:   "border-amber-500/50 text-amber-400",
    rose:    "border-rose-500/50 text-rose-400",
  }[tone];
  return <span className={`${base} ${toneCls}`}>{children}</span>;
}
function roleTone(role: string): "green"|"blue"|"amber"|"rose"|"default" {
  const r = role.toLowerCase();
  if (r === "admin") return "rose";
  if (r === "manager") return "amber";
  if (r === "cashier") return "green";
  if (r === "staff") return "blue";
  if (r === "accountant") return "green";
  return "default";
}

/* ========================================================================== */

export default function TeamManager() {
  const lic = useMemo(() => getLicense(), []);
  const [users, setUsers] = useState(() => getUsers());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // form state
  const initialRole: AnyRole = assignableRolesForPlan(lic.plan)[0] ?? "manager";
  const [form, setForm] = useState<NewUser>({ username: "", pin: "", role: initialRole });

  // filters (for nicer UX)
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "__sp_changed__") setUsers(getUsers()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const limitUsers = PLAN_META[lic.plan].limits.users;
  const canAddMore = users.length < limitUsers;
  const usersLeft = Math.max(0, limitUsers - users.length);

  const visibleUsers = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return users
      .filter(u => (roleFilter === "all" ? true : String(u.role).toLowerCase() === roleFilter))
      .filter(u => {
        if (!ql) return true;
        const name = u.username.toLowerCase();
        const role = String(u.role).toLowerCase();
        return name.includes(ql) || role.includes(ql);
      });
  }, [users, q, roleFilter]);

  /* ----------------------------- actions ----------------------------- */
  async function onAddUser(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (isFreeOrTrial(lic.plan)) { setErr("Your plan supports only the admin."); return; }
    if (!canAddMore) { setErr("User limit reached for your plan."); return; }

    const username = form.username.trim();
    const pin = digitsOnly(form.pin);

    if (!username) { setErr("Username is required."); return; }
    if (!pin) { setErr("PIN is required."); return; }
    if (!/^\d+$/.test(pin)) { setErr("PIN must contain only digits."); return; }

    const unameTaken = users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (unameTaken) { setErr("That username already exists."); return; }

    let role = sanitizeAssignedRole(form.role, lic.plan);
    if (!isEnterprise(lic.plan)) {
      const allowed = new Set(assignableRolesForPlan(lic.plan).map(String));
      if (!allowed.has(String(role))) role = assignableRolesForPlan(lic.plan)[0];
    }
    if (String(role).toLowerCase() === "admin") { setErr("Only one admin is allowed."); return; }

    try {
      setBusy(true);
      const u = await createUser(username, pin, role as Role);
      setUsers(getUsers());
      setForm({ username: "", pin: "", role: initialRole });
      alert(`User ${u.username} created.`);
    } catch (e: any) {
      setErr(e?.message || "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  function onChangeRole(id: string, next: AnyRole) {
    let role = sanitizeAssignedRole(next, lic.plan);
    if (!isEnterprise(lic.plan)) {
      const allowed = new Set(assignableRolesForPlan(lic.plan).map(String));
      if (!allowed.has(String(role))) role = assignableRolesForPlan(lic.plan)[0];
    }

    const list = getUsers().map(u => {
      if (u.id !== id) return u;
      if (u.role === "admin") return u; // admin immutable
      if (String(role).toLowerCase() === "admin") return u; // no elevation
      return { ...u, role: role as Role };
    });

    saveUsers(list);
    setUsers(list);
    try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
  }

  function onRemoveUser(id: string) {
    const target = users.find(u => u.id === id);
    if (!target) return;
    if (target.role === "admin") { alert("You cannot remove the only admin."); return; }
    if (!confirm("Remove this user? They will lose access on this device.")) return;

    const list = getUsers().filter(u => u.id !== id);
    saveUsers(list);
    setUsers(list);
    setAvatar(id, null);
    try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
  }

  function onPickAvatar(uId: string) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAvatar(uId, String(reader.result || ""));
        setUsers(getUsers()); // just to re-render
        try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  const assignable = assignableRolesForPlan(lic.plan);
  const planLabel = isEnterprise(lic.plan)
    ? "custom roles (e.g., manager/staff/cashier/accountant)"
    : isPro(lic.plan)
    ? "manager, staff, cashier"
    : "admin only";
  const showAddForm = !isFreeOrTrial(lic.plan);

  /* ----------------------------------- UI ----------------------------------- */
  return (
    <div className="p-0 rounded-2xl overflow-hidden border border-[var(--line)] bg-[var(--panel)] shadow-sm">
      {/* gradient header */}
      <div className="p-5 bg-[linear-gradient(135deg,_rgba(99,102,241,.18),_rgba(56,189,248,.14))] border-b border-[var(--line)]/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Team</h3>
            <p className="text-sm opacity-75">
              Manage users on this device. Roles allowed: <b>{planLabel}</b>. No second <b>admin</b>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone="blue">Plan: {lic.plan}</Chip>
            <Chip>Users {users.length}/{limitUsers}</Chip>
            {usersLeft > 0 ? <Chip tone="green">{usersLeft} left</Chip> : <Chip tone="amber">Limit reached</Chip>}
          </div>
        </div>

        {/* filters */}
        <div className="grid gap-2 mt-4 sm:grid-cols-12">
          <div className="sm:col-span-8">
            <input
              value={q}
              onChange={e=>setQ(e.target.value)}
              placeholder="Search by username or role…"
              className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel),#ffffff_3%)]"
            />
          </div>
          <div className="sm:col-span-4">
            <div className="flex gap-2">
              <select
                value={roleFilter}
                onChange={e=>setRoleFilter(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel),#ffffff_3%)]"
                title="Filter by role"
              >
                <option value="all">All roles</option>
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="staff">staff</option>
                <option value="cashier">cashier</option>
                <option value="accountant">accountant</option>
              </select>
              <button
                onClick={()=>{ setQ(""); setRoleFilter("all"); }}
                className="px-3 py-2 rounded-xl border border-[var(--line)] hover:bg-[var(--line)]/25"
                title="Clear filters"
                type="button"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* add form */}
      <div className="p-5">
        {showAddForm ? (
          <form onSubmit={onAddUser} className="grid gap-3 sm:grid-cols-12 p-3 rounded-xl border border-[var(--line)]/60 bg-[var(--panel)]/40">
            <label className="sm:col-span-4">
              <div className="mb-1 text-xs opacity-70">Username</div>
              <input
                placeholder="e.g. john_doe"
                value={form.username}
                onChange={e=>setForm({...form, username: e.target.value})}
                className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
              />
            </label>

            <label className="sm:col-span-4">
              <div className="mb-1 text-xs opacity-70">PIN (digits only)</div>
              <input
                {...pinInputProps(form.pin, (v)=>setForm({...form, pin: v}))}
                placeholder={`${PIN_MAX}-digit PIN`}
                className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
              />
              <div className="text-[11px] mt-1 opacity-60">Max {PIN_MAX} digits.</div>
            </label>

            <label className="sm:col-span-3">
              <div className="mb-1 text-xs opacity-70">Role</div>
              {isEnterprise(lic.plan) ? (
                <select
                  value={assignable.includes(String(form.role)) ? String(form.role) : "custom…"}
                  onChange={(e)=>{
                    const val = e.target.value;
                    if (val === "custom…") {
                      const entered = prompt("Enter a custom role (not 'admin'):", "");
                      setForm({...form, role: entered ? sanitizeAssignedRole(entered, lic.plan) : "manager"});
                    } else {
                      setForm({...form, role: val});
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
                >
                  {assignable.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <select
                  value={String(form.role)}
                  onChange={e=>setForm({...form, role: e.target.value as AnyRole})}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-transparent"
                >
                  {assignable.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </label>

            <div className="flex items-end sm:col-span-1">
              <button
                disabled={busy || !canAddMore}
                className="w-full px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/25 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>
        ) : (
          <div className="text-sm italic opacity-70">Your plan supports only one admin. Upgrade to add team members.</div>
        )}

        {!canAddMore && <div className="mt-2 text-xs text-amber-400">You reached your plan’s user limit.</div>}
        {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
      </div>

      {/* users grid */}
      <div className="px-5 pb-6">
        {visibleUsers.length === 0 ? (
          <div className="p-10 text-center rounded-2xl border border-dashed border-[var(--line)]/70">
            <div className="mb-2 text-3xl">🧑‍🤝‍🧑</div>
            <div className="font-medium">No users match your filter</div>
            <div className="text-sm opacity-70">Clear search or change the role filter.</div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleUsers.map(u => {
              const avatar = getAvatar(u.id);
              const isUAdmin = String(u.role).toLowerCase() === "admin";
              const roleChoices = isEnterprise(lic.plan) ? [...assignable] : assignable;

              return (
                <div
                  key={u.id}
                  className="group rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel),#ffffff_2%)] hover:bg-[color-mix(in_oklab,var(--panel),#ffffff_5%)] transition-colors"
                >
                  <div className="flex items-center gap-3 p-3">
                    <div className="relative w-11 h-11 rounded-full overflow-hidden bg-[var(--line)] flex items-center justify-center">
                      {avatar ? (
                        <img src={avatar} className="object-cover w-full h-full" />
                      ) : (
                        <span className="text-xs opacity-60">{u.username.slice(0,2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{u.username}</div>
                      <div className="mt-0.5"><Chip tone={roleTone(String(u.role))}>{String(u.role)}</Chip></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 pt-0 pb-3">
                    <select
                      value={isEnterprise(lic.plan) && !roleChoices.includes(String(u.role)) ? "custom…" : String(u.role)}
                      disabled={isUAdmin}
                      onChange={e=>{
                        const val = e.target.value as AnyRole;
                        if (val === "custom…") {
                          const entered = prompt("Enter a custom role (not 'admin'):", String(u.role));
                          if (entered) onChangeRole(u.id, entered);
                        } else {
                          onChangeRole(u.id, val);
                        }
                      }}
                      className="flex-1 px-2 py-2 rounded-lg border border-[var(--line)] bg-transparent text-sm disabled:opacity-50"
                    >
                      {isUAdmin ? (
                        <option value="admin">admin</option>
                      ) : (
                        roleChoices.map(r => <option key={r} value={r}>{r}</option>)
                      )}
                    </select>

                    <button
                      onClick={()=>onPickAvatar(u.id)}
                      className="px-2 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/20 text-sm"
                      title="Set photo"
                      type="button"
                    >
                      {/* small inline svg icon */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 8c3.866 0 7 2.239 7 5v1H5v-1c0-2.761 3.134-5 7-5Z"/></svg>
                    </button>

                    <button
                      onClick={()=>onRemoveUser(u.id)}
                      disabled={isUAdmin}
                      className="px-2 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/20 text-sm disabled:opacity-50"
                      title={isUAdmin ? "Admin cannot be removed" : "Remove user"}
                      type="button"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v2h5v2H4V5h5V3Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Z"/></svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
