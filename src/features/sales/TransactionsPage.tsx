// src/pages/transactions/TransactionsPage.tsx
import { useEffect, useMemo, useState } from "react";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";

import {
  addTransaction,
  getTransactionsForDay,
  deleteTransaction,
  restoreTransaction,
  getDeletedTransactions,
  purgeDeletedTransaction,
  purgeAllDeletedTransactions,
  setPaidFlag,
  getPaidMap,
  isAdmin,
  money,
  type Transaction,
  type TxKind,
} from "../../spCore";

import { subscribeChanges } from "../../index"; // same-tab notifier
import Modal from "../../ui/Modal";
import { getCompany } from "../../lib/company";
import ReceiptModal from "./ReceiptModal";

/* ---------- local-safe "today" ---------- */
function todayISO(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tz);
  return local.toISOString().slice(0, 10);
}

/* ---------- line items ---------- */
type LineItem = {
  id: string;
  description: string;
  qty: string;
  unit_price: string;
  amount: string;
  dirty?: boolean;
};
const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `li_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const newItem = (): LineItem => ({
  id: makeId(),
  description: "",
  qty: "1",
  unit_price: "0",
  amount: "0.00",
});

/* ---------- suggestion sets ---------- */
const CUST_SET_KEY = "sp_custSet:v1";
const DESC_SET_KEY = "sp_descSet:v1";
function readSet(k: string): Set<string> {
  try {
    const r = localStorage.getItem(k);
    return r ? new Set(JSON.parse(r)) : new Set();
  } catch {
    return new Set();
  }
}
function writeSet(k: string, s: Set<string>) {
  try {
    localStorage.setItem(k, JSON.stringify([...s]));
  } catch {}
}

/* ---------- Receipt bridge ---------- */
type TxReceipt = {
  id: string;
  occurred_on: string;
  customer_name: string | null;
  description: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  method: string | null;
  reference: string | null;
};

function qtyOf(t: Transaction): number {
  const q = Number((t as any).qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function unitOf(t: Transaction): number {
  const q = qtyOf(t);
  const u = Number((t as any).unit_price);
  if (Number.isFinite(u)) return u;
  const derived = q > 0 ? t.amount / q : t.amount;
  return Number.isFinite(derived) ? derived : 0;
}
function toReceipt(t: Transaction): TxReceipt {
  return {
    id: t.id,
    occurred_on: t.occurred_on,
    customer_name: t.customer_name ?? null,
    description: t.description ?? null,
    qty: qtyOf(t),
    unit_price: unitOf(t),
    amount: t.amount,
    method: t.method ?? null,
    reference: t.reference ?? null,
  };
}

/* ===================================================================== */
export default function TransactionsPage() {
  // one date drives entry + listing
  const [currentDate, setCurrentDate] = useState<string>(todayISO());

  // header fields
  const [kind, setKind] = useState<TxKind>("income");
  const [customer, setCustomer] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");

  // line items
  const [items, setItems] = useState<LineItem[]>([newItem()]);

  // data / filters
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paidMap, setPaidMapState] = useState<Record<string, boolean>>(() => getPaidMap());
  const [filterKind, setFilterKind] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");

  // suggestions
  const [custSet, setCustSet] = useState<Set<string>>(() => readSet(CUST_SET_KEY));
  const [descSet, setDescSet] = useState<Set<string>>(() => readSet(DESC_SET_KEY));

  // admin / trash
  const admin = isAdmin();
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<Transaction[]>([]);

  // receipt modal (saved transactions)
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<TxReceipt | TxReceipt[] | null>(null);

  // select receipts mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // PREVIEW for unsaved entry
  const [previewOpen, setPreviewOpen] = useState(false);
  const company = getCompany();

  // pulse for same-tab / cross-tab updates
  const [pulse, setPulse] = useState(0);

  /* ---------- load + realtime ---------- */
  useEffect(() => { refreshDay(); /* eslint-disable-next-line */ }, [currentDate]);

  useEffect(() => {
    const cb = () => setPulse(p => p + 1);
    const off = subscribeChanges(cb);
    const onDom = () => cb();
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "__sp_changed__") return;
      cb();
    };
    window.addEventListener("sp:changed", onDom);
    window.addEventListener("storage", onStorage);
    return () => {
      off();
      window.removeEventListener("sp:changed", onDom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    // whenever pulse increments, refresh data
    refreshDay();
    if (showTrash) refreshTrash();
    // eslint-disable-next-line
  }, [pulse, showTrash]);

  useEffect(() => { if (showTrash) refreshTrash(); /* eslint-disable-next-line */ }, [showTrash, currentDate]);

  /* ---------- totals ---------- */
  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    transactions.forEach(t => (t.kind === "income" ? (inc += t.amount) : (exp += t.amount)));
    return { income: inc, expense: exp, net: inc - exp };
  }, [transactions]);

  /* ---------- entry subtotal ---------- */
  const subtotal = useMemo(
    () => items.reduce((sum, it) => sum + (parseFloat(it.amount || "0") || 0), 0),
    [items]
  );

  /* ---------- filtered list ---------- */
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return transactions.filter(t => {
      if (filterKind !== "all" && t.kind !== filterKind) return false;
      const paid = !!paidMap[t.id];
      if (paidFilter === "paid" && !paid) return false;
      if (paidFilter === "unpaid" && paid) return false;
      if (!s) return true;
      return (
        (t.customer_name || "").toLowerCase().includes(s) ||
        (t.description || "").toLowerCase().includes(s) ||
        (t.reference || "").toLowerCase().includes(s)
      );
    });
  }, [transactions, filterKind, paidFilter, search, paidMap]);

  /* ---------- helpers ---------- */
  function refreshDay() {
    const list = getTransactionsForDay(currentDate);

    // newest-first
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    setTransactions(list);

    const cs = new Set(custSet), ds = new Set(descSet);
    list.forEach(t => {
      if (t.customer_name) cs.add(t.customer_name);
      if (t.description) ds.add(t.description);
    });
    setCustSet(cs); setDescSet(ds); writeSet(CUST_SET_KEY, cs); writeSet(DESC_SET_KEY, ds);

    setPaidMapState({ ...getPaidMap() });
  }

  function refreshTrash() {
    const all = getDeletedTransactions();
    const sameDay = all.filter(t => t.occurred_on === currentDate);
    sameDay.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    setTrash(sameDay);
  }

  function recalc(it: LineItem): LineItem {
    if (it.dirty) return it;
    const q = parseFloat(it.qty || "0");
    const u = parseFloat(it.unit_price || "0");
    return { ...it, amount: (q * u).toFixed(2) };
  }
  function setItem<K extends keyof LineItem>(id: string, key: K, val: LineItem[K]) {
    setItems(prev => prev.map(x => (x.id === id ? recalc({ ...x, [key]: val }) : x)));
  }
  function setItemAmount(id: string, val: string) {
    setItems(prev => prev.map(x => (x.id === id ? { ...x, amount: val, dirty: true } : x)));
  }
  function addItem() { setItems(p => [...p, newItem()]); }
  function removeItem(id: string) { setItems(p => (p.length > 1 ? p.filter(x => x.id !== id) : p)); }

  /* ---------- save batch ---------- */
  function saveBatch() {
    setErr("");
    const normalized = items.map(recalc);

    const valid = normalized.filter(it => {
      const amt = parseFloat(it.amount || "0");
      return it.description.trim().length > 0 && Number.isFinite(amt) && amt > 0;
    });
    if (!customer.trim()) { setErr("Add a customer name."); return; }
    if (valid.length === 0) { setErr("Add at least one line with description and amount."); return; }

    const group = `SP-${currentDate.replace(/-/g, "")}-${makeId().slice(0, 8)}`;

    try {
      for (const it of valid) {
        addTransaction({
          kind,
          customer_name: customer.trim(),
          description: it.description.trim(),
          qty: parseFloat(it.qty || "0"),
          unit_price: parseFloat(it.unit_price || "0"),
          amount: parseFloat(it.amount || "0"),
          method: method || null,
          reference: reference ? `${reference} | ${group}` : group,
          occurred_on: currentDate,
        });
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to save.");
      return;
    }

    const cs = new Set(custSet).add(customer.trim());
    const ds = new Set(descSet); valid.forEach(v => ds.add(v.description.trim()));
    setCustSet(cs); setDescSet(ds); writeSet(CUST_SET_KEY, cs); writeSet(DESC_SET_KEY, ds);

    setItems([newItem()]); setMethod(""); setReference("");
    refreshDay();
    try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
  }

  /* ---------- row actions ---------- */
  function togglePaid(id: string) {
    const paid = !!paidMap[id];
    setPaidFlag(id, !paid);
    setPaidMapState({ ...getPaidMap() });
  }

  function removeTx(id: string) {
    const snap = transactions.find(t => t.id === id);
    if (!snap) return;
    if (!window.confirm("Delete this transaction? You can Undo.")) return;

    deleteTransaction(id, "user-delete");
    refreshDay();
    if (showTrash) refreshTrash();

    // Undo snackbar
    const undoSecs = 8;
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#0f1722;border:1px solid var(--line);padding:10px 14px;border-radius:12px;z-index:9999;display:flex;gap:8px;align-items:center";
    bar.innerHTML = `<span>Deleted.</span><button id="sp-undo" class="btn-ghost">Undo</button>`;
    document.body.appendChild(bar);

    let undone = false;
    const timer = setTimeout(() => {
      if (!undone && document.body.contains(bar)) document.body.removeChild(bar);
    }, undoSecs * 1000);

    bar.querySelector("#sp-undo")?.addEventListener("click", () => {
      undone = true;
      clearTimeout(timer);
      restoreTransaction(id);
      refreshDay();
      if (showTrash) refreshTrash();
      if (document.body.contains(bar)) document.body.removeChild(bar);
    });
  }

  /* ---------- receipt helpers (saved) ---------- */
  function openReceiptFor(t: Transaction) {
    setReceiptTx(toReceipt(t));
    setReceiptOpen(true);
  }

  function openSelectedReceipt() {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) {
      alert("Select one or more transactions to open a receipt.");
      return;
    }
    const rows = filtered.filter(x => ids.includes(x.id)).map(toReceipt);
    setReceiptTx(rows.length === 1 ? rows[0] : rows);
    setReceiptOpen(true);
  }

  function toggleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    const next: Record<string, boolean> = {};
    filtered.forEach((t) => (next[t.id] = checked));
    setSelected(next);
  }

  function bulkMarkPaid(flag: boolean) {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    ids.forEach(id => setPaidFlag(id, flag));
    setPaidMapState({ ...getPaidMap() });
  }

  /* ---------- preview helpers (unsaved) ---------- */
  function previewWhatsAppText() {
    const lines: string[] = [];
    lines.push(`${company.name || "Your Company"}`);
    const meta = [company.address, company.email, company.phone].filter(Boolean).join(" • ");
    if (meta) lines.push(meta);
    lines.push("");
    lines.push(`Customer: ${customer || "-"}`);
    if (reference) lines.push(`Ref: ${reference}`);
    if (method) lines.push(`Method: ${method}`);
    lines.push("");
    lines.push("Items:");
    lines.push("Desc | Qty | Unit | Total");
    items
      .map(recalc)
      .filter(it => it.description.trim() && Number(it.amount) > 0)
      .forEach(it => {
        const q = parseFloat(it.qty || "0") || 0;
        const u = parseFloat(it.unit_price || "0") || 0;
        const tot = parseFloat(it.amount || "0") || 0;
        lines.push(`${it.description} | ${q} | ${money(u)} | ${money(tot)}`);
      });
    lines.push("");
    lines.push(`Subtotal: ${money(subtotal)}`);
    return lines.join("\n");
  }
  function sharePreviewWhatsApp() {
    const text = encodeURIComponent(previewWhatsAppText());
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
  }

  /* ================================ UI ================================ */
  return (
    <div className="grid gap-4">
      {/* Header */}
      <Card>
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">Quick Sales & Expenses</h1>
          <div className="flex flex-wrap items-center gap-3">
            <label className="label">Day</label>
            <input
              className="w-auto control"
              type="date"
              value={currentDate}
              onChange={(e) => setCurrentDate(e.target.value || todayISO())}
            />
            <button className="btn-ghost" onClick={() => setCurrentDate(todayISO())}>Today</button>
            <button className="btn-ghost" onClick={refreshDay}>Refresh</button>

            {/* Admin: Toggle Trash */}
            {admin && (
              <label className="flex items-center gap-2 ml-2 text-sm">
                <input type="checkbox" checked={showTrash} onChange={(e) => setShowTrash(e.target.checked)} />
                <span>Show Trash</span>
              </label>
            )}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Pill label="Total Income" value={money(totals.income)} color="ok" />
          <Pill label="Total Expense" value={money(totals.expense)} color="bad" />
          <Pill label="Net" value={money(totals.net)} color={totals.net >= 0 ? "ok" : "bad"} />
        </div>
      </Card>

      {/* Entry */}
      <Card>
        <h2 className="mb-3 text-xl font-bold">Add Transaction</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-12">
            <span className="label">Type</span>
            <div className="segment">
              <input id="t-income" type="radio" name="type" value="income"
                     checked={kind === "income"} onChange={() => setKind("income")} />
              <label htmlFor="t-income" className="positive">Income</label>
              <input id="t-expense" type="radio" name="type" value="expense"
                     checked={kind === "expense"} onChange={() => setKind("expense")} />
              <label htmlFor="t-expense" className="negative">Expense</label>
            </div>
          </div>

          <div className="field md:col-span-6">
            <label className="label">Customer Name</label>
            <input className="control" value={customer} onChange={(e)=>setCustomer(e.target.value)}
                   list="customerList" placeholder="e.g., Best Customer Ltd." />
            <datalist id="customerList">
              {[...custSet].slice(0,100).sort().map(v => <option key={v} value={v} />)}
            </datalist>
          </div>

          <div className="field md:col-span-3">
            <label className="label">Method</label>
            <select className="select" value={method} onChange={(e)=>setMethod(e.target.value)}>
              <option value="">—</option><option>cash</option><option>transfer</option><option>POS</option>
            </select>
          </div>

          <div className="field md:col-span-3">
            <label className="label">Reference / Note</label>
            <input className="control" value={reference} onChange={(e)=>setReference(e.target.value)}
                   placeholder="optional note or bank ref" />
          </div>
        </div>

        {/* Line items: mobile cards */}
        <div className="mt-4">
          <div className="grid gap-3 md:hidden">
            {items.map((it, idx) => (
              <div key={it.id} className="card">
                <div className="field">
                  <label className="label">Description</label>
                  <input className="control" value={it.description}
                         onChange={(e)=>setItem(it.id,"description",e.target.value)}
                         list="descList" placeholder="e.g., iPhone case, 50kg potatoes…" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field">
                    <label className="label">Qty</label>
                    <input className="control" type="number" min="0" step="0.01"
                           value={it.qty} onChange={(e)=>setItem(it.id,"qty",e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Unit (₦)</label>
                    <div className="input-wrap">
                      <span className="input-prefix">₦</span>
                      <input className="control with-prefix" type="number" min="0" step="0.01"
                             value={it.unit_price} onChange={(e)=>setItem(it.id,"unit_price",e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label className="label">Amount (₦)</label>
                  <div className="input-wrap">
                    <span className="input-prefix">₦</span>
                    <input className="control with-prefix" type="number" min="0" step="0.01"
                           value={it.amount} onChange={(e)=>setItemAmount(it.id,e.target.value)}
                           placeholder="auto (qty × unit)" />
                  </div>
                </div>
                <div className="flex justify-between mt-2">
                  <span className="muted">Item {idx + 1}</span>
                  <button className="btn-ghost" onClick={()=>removeItem(it.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop entry table */}
          <div className="hidden overflow-auto md:block">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Description</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[120px]">Qty</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[160px]">Unit (₦)</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[180px]">Amount (₦)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id} className={idx % 2 ? "bg-[#0e1526]/30" : ""}>
                    <td className="px-3 py-2">
                      <input className="control" value={it.description}
                             onChange={(e)=>setItem(it.id,"description",e.target.value)}
                             list="descList" placeholder="e.g., iPhone case, 50kg potatoes…" />
                    </td>
                    <td className="px-3 py-2">
                      <input className="control" type="number" min="0" step="0.01"
                             value={it.qty} onChange={(e)=>setItem(it.id,"qty",e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="input-wrap">
                        <span className="input-prefix">₦</span>
                        <input className="control with-prefix" type="number" min="0" step="0.01"
                               value={it.unit_price} onChange={(e)=>setItem(it.id,"unit_price",e.target.value)} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="input-wrap">
                        <span className="input-prefix">₦</span>
                        <input className="control with-prefix" type="number" min="0" step="0.01"
                               value={it.amount} onChange={(e)=>setItemAmount(it.id,e.target.value)}
                               placeholder="auto (qty × unit)" />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button className="btn-ghost" onClick={()=>removeItem(it.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <datalist id="descList">
            {[...descSet].slice(0,100).sort().map(v => <option key={v} value={v} />)}
          </datalist>
        </div>

        {/* actions */}
        <div className="flex flex-col gap-3 mt-3 md:flex-row md:items-center md:justify-between">
          <button className="w-full btn-ghost md:w-auto" onClick={addItem}>+ Add another item</button>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">Subtotal</div>
            <div className="text-2xl font-extrabold">{money(subtotal)}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-3 md:flex-row md:items-center">
          {err && <span className="err md:flex-1">{err}</span>}
          {/* Preview BEFORE save */}
          <button className="btn-ghost" onClick={() => setPreviewOpen(true)}>Preview Receipt</button>
          <button className="btn md:ml-auto" onClick={saveBatch}>Save</button>
        </div>
      </Card>

      {/* LIST */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-center">
          <h2 className="text-lg font-bold">
            Transactions — <span className="text-[var(--muted)]">{currentDate}</span>
          </h2>
          <div className="flex flex-col gap-2 md:ml-auto sm:flex-row sm:flex-wrap sm:items-center">
            <select className="w-full select sm:w-auto" value={filterKind} onChange={(e)=>setFilterKind(e.target.value)}>
              <option value="all">All</option><option value="income">Income</option><option value="expense">Expense</option>
            </select>
            <select className="w-full select sm:w-auto" value={paidFilter} onChange={(e)=>setPaidFilter(e.target.value)}>
              <option value="all">All</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option>
            </select>
            <input className="control w-full sm:w-[240px]" placeholder="Search customer / description"
                   value={search} onChange={(e)=>setSearch(e.target.value)} />
            {/* Select receipts toggle */}
            <label className="flex items-center gap-2 ml-0 text-sm sm:ml-2">
              <input
                type="checkbox"
                checked={selectMode}
                onChange={(e) => {
                  setSelectMode(e.target.checked);
                  setSelected({});
                }}
              />
              <span>Select receipts</span>
            </label>
            {selectMode && (
              <>
                <button className="btn-ghost" onClick={openSelectedReceipt}>Open receipt for selected</button>
                <button className="btn-ghost" onClick={() => bulkMarkPaid(true)}>Mark selected Paid</button>
                <button className="btn-ghost" onClick={() => bulkMarkPaid(false)}>Mark selected Unpaid</button>
              </>
            )}
          </div>
        </div>

        {/* Responsive list: cards on mobile, table on md+ */}
        <div className="grid gap-2 md:hidden">
          {filtered.length === 0 ? (
            <div className="p-3 rounded bg-[#07132b] text-center text-[var(--muted)]">No transactions for {currentDate}.</div>
          ) : filtered.map((t) => {
            const isPaid = !!paidMap[t.id];
            const q = qtyOf(t);
            const u = unitOf(t);
            return (
              <div key={t.id} className="p-3 rounded-lg bg-[#07132b] border border-[#10203a]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{t.customer_name || "—"}</div>
                      <div className="text-xs text-slate-400">{new Date(t.created_at).toLocaleTimeString()}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{t.description || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold">{money(t.amount)}</div>
                    <div className="text-xs">{t.kind} • {isPaid ? "Paid" : "Unpaid"}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button className="btn-ghost" onClick={() => togglePaid(t.id)}>{isPaid ? "Mark Unpaid" : "Mark Paid"}</button>
                  <button className="btn-ghost" onClick={() => openReceiptFor(t)}>Receipt</button>
                  <button className="btn-ghost" onClick={() => removeTx(t.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="w-full border-collapse text-[0.94rem]">
            <thead className="sticky top-0 bg-[#0f1722]">
              <tr className="text-left">
                {selectMode && (
                  <th className="px-3 py-2 w-[44px]">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={
                        filtered.length > 0 &&
                        filtered.every((t) => selected[t.id])
                      }
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Date/Time</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Customer</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Type</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Qty</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Unit (₦)</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Amount (₦)</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Description</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Method / Ref</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={selectMode ? 10 : 9} className="px-3 py-3 text-center text-[var(--muted)]">No transactions for {currentDate}.</td></tr>
              ) : (
                filtered.map((t, i) => {
                  const isPaid = !!paidMap[t.id];
                  const q = qtyOf(t);
                  const u = unitOf(t);
                  return (
                    <tr key={t.id} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      {selectMode && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!selected[t.id]}
                            onChange={(e) =>
                              setSelected((s) => ({ ...s, [t.id]: e.target.checked }))
                            }
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">{t.customer_name || "—"}</td>
                      <td className="px-3 py-2">
                        <span className="tag">{t.kind}</span>{" "}
                        <span className={`tag ${isPaid ? "paid-pill" : "unpaid-pill"}`}>{isPaid ? "Paid" : "Unpaid"}</span>
                      </td>
                      <td className="px-3 py-2">{q}</td>
                      <td className="px-3 py-2">{money(u)}</td>
                      <td className="px-3 py-2 font-extrabold">{money(t.amount)}</td>
                      <td className="px-3 py-2">{t.description || "—"}</td>
                      <td className="px-3 py-2">{[t.method, t.reference].filter(Boolean).join(" • ") || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button className="btn-ghost" onClick={() => togglePaid(t.id)}>
                            {isPaid ? "Mark Unpaid" : "Mark Paid"}
                          </button>
                          <button className="btn-ghost" onClick={() => openReceiptFor(t)}>Receipt</button>
                          <button className="btn-ghost" onClick={() => removeTx(t.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* =================== TRASH (Admin only) =================== */}
      {admin && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Trash</h2>
            {showTrash && trash.length > 0 && (
              <button
                className="btn-ghost"
                onClick={() => {
                  if (!confirm("Permanently purge ALL deleted transactions?")) return;
                  purgeAllDeletedTransactions();
                  refreshTrash();
                }}
              >
                Purge All
              </button>
            )}
          </div>

          {!showTrash ? (
            <p className="text-sm text-[var(--muted)]">Hidden. Toggle “Show Trash” above to review.</p>
          ) : trash.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing in trash for this day.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Description</th>
                    <th>Deleted At</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trash.map((t) => (
                    <tr key={t.id} className="border-b border-[var(--line)]/40">
                      <td className="py-2">{new Date(t.created_at).toLocaleString()}</td>
                      <td><span className="tag">{t.kind}</span></td>
                      <td className="font-semibold">{money(t.amount)}</td>
                      <td>{t.description || "—"}</td>
                      <td>{(t as any).deleted_at ? new Date((t as any).deleted_at).toLocaleString() : "—"}</td>
                      <td className="text-[var(--muted)]">{(t as any).deleted_reason || "—"}</td>
                      <td className="flex gap-2">
                        <button
                          className="btn-ghost"
                          onClick={() => { restoreTransaction(t.id); refreshTrash(); refreshDay(); }}
                        >
                          Restore
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            if (!confirm("Permanently delete this transaction?")) return;
                            purgeDeletedTransaction(t.id);
                            refreshTrash();
                          }}
                        >
                          Purge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Receipt modal (single or multi) */}
      <ReceiptModal tx={receiptTx as any} open={receiptOpen} onClose={() => setReceiptOpen(false)} />

      {/* PREVIEW RECEIPT (unsaved) */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview Receipt">
        <div className="p-4 text-black bg-white shadow-sm sm:p-6 rounded-2xl" style={{ maxWidth: 720, margin: "0 auto", border: "1px solid #e5e7eb" }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xl font-bold tracking-tight">{company.name || "Your Company"}</div>
              {(company.address || company.email || company.phone) && (
                <div className="mt-1 text-[13px] text-neutral-600 space-y-0.5">
                  {company.address && <div className="truncate">{company.address}</div>}
                  {(company.email || company.phone) && (
                    <div className="truncate">
                      {company.email || ""}{company.email && company.phone ? " · " : ""}{company.phone || ""}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="w-16 h-16 overflow-hidden bg-white border rounded-xl border-neutral-200 shrink-0">
              {company.logo ? <img src={company.logo} className="object-cover w-full h-full" /> : null}
            </div>
          </div>

          {/* Meta */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
            <div className="space-y-1">
              <div><span className="text-neutral-600">Customer:</span> <b>{customer || "—"}</b></div>
              {reference ? <div><span className="text-neutral-600">Ref:</span> <b>{reference}</b></div> : null}
            </div>
            <div className="space-y-1 text-right">
              {method ? <div><span className="text-neutral-600">Method:</span> <b>{method}</b></div> : <div>&nbsp;</div>}
              <div><span className="text-neutral-600">Subtotal:</span> <b>{money(subtotal)}</b></div>
            </div>
          </div>

          {/* Items */}
          <div className="mt-4 overflow-hidden border rounded-xl border-neutral-200">
            <table className="w-full text-[13px]">
              <thead className="bg-neutral-50 text-neutral-700">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-2 font-medium text-left">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Unit</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map(recalc).filter(it => it.description.trim() && Number(it.amount) > 0).map(it => {
                  const q = parseFloat(it.qty || "0") || 0;
                  const u = parseFloat(it.unit_price || "0") || 0;
                  const tot = parseFloat(it.amount || "0") || 0;
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right">{q}</td>
                      <td className="px-3 py-2 text-right">{money(u)}</td>
                      <td className="px-3 py-2 text-right">{money(tot)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100" onClick={sharePreviewWhatsApp} type="button">
            Share via WhatsApp
          </button>
          <button className="px-3 py-2 ml-auto border rounded-lg border-neutral-300 hover:bg-neutral-100" onClick={() => setPreviewOpen(false)} type="button">
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}
