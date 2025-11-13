import { useState, useEffect, useMemo } from "react";
import { getAvatar } from "../../lib/avatars";
import {
  addProduct,
  getProducts,
  deleteProduct,
  isAdmin,
  isAccountant,
  money,
  type Product,
  getLicense, // <-- used to read current plan
} from "../../index";
import Card from "../../ui/Card";
import InputRow from "../../ui/InputRow";
import Button from "../../ui/Button";

/* ----------------------------- caps ------------------------------ */
/** Fallback caps if you don’t import a central PLAN_LIMITS. */
type Plan = "trial" | "free" | "small" | "large";
const PLAN_LIMITS: Record<Plan, { productsMax: number }> = {
  trial: { productsMax: 80 },
  free:  { productsMax: 80 },
  small: { productsMax: 400 },
  large: { productsMax: 5000 },
};

/* ------------------------- local helpers ------------------------- */
const ARCH_KEY = "sp_archived_products:v1";
const CATEGORY_KEY = "sp_category_suggestions:v1";

function readSet(key: string): Set<string> {
  try {
    const r = localStorage.getItem(key);
    return r ? new Set(JSON.parse(r)) : new Set();
  } catch {
    return new Set();
  }
}
function writeSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {}
}

function copy(text?: string | null) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

type SortKey = "new" | "name" | "stock" | "priceUp" | "priceDown";

/**
 * Manage products with gorgeous, responsive UI + plan caps.
 */
export default function ProductsPage() {
  const admin = isAdmin() || isAccountant();

  // state
  const [items, setItems] = useState<Product[]>([]);
  const [archived, setArchived] = useState<Set<string>>(() => readSet(ARCH_KEY));
  const [showArchived, setShowArchived] = useState(false);

  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("new");

  const [form, setForm] = useState<Partial<Product>>({
    name: "",
    sku: "",
    category: "",
    cost_price: 0,
    sell_price: 0,
    qty_in_stock: 0,
    alert_threshold: 0,
  });
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const [catSuggest, setCatSuggest] = useState<Set<string>>(() => readSet(CATEGORY_KEY));

  /* ---------------------- effects / data flow --------------------- */
  function refresh() {
    const list = getProducts().slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    setItems(list);

    // build category suggestions
    const s = new Set(catSuggest);
    list.forEach((p) => {
      if (p.category) s.add(p.category);
    });
    setCatSuggest(s);
    writeSet(CATEGORY_KEY, s);
  }
  useEffect(refresh, []); // load once

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim().toLowerCase()), 180);
    return () => clearTimeout(t);
  }, [q]);

  /* --------------------------- derived --------------------------- */
  const activeItems = useMemo(
    () => items.filter((p) => !archived.has(p.id)),
    [items, archived]
  );

  const { plan = "free" as Plan } = (() => {
    try {
      return getLicense?.() ?? { plan: "free" as Plan };
    } catch {
      return { plan: "free" as Plan };
    }
  })();

  const productCap = PLAN_LIMITS[plan]?.productsMax ?? 80;
  const activeCount = activeItems.length;
  const capLeft = Math.max(productCap - activeCount, 0);
  const capRatio = Math.min(activeCount / productCap, 1);

  const kpis = useMemo(() => {
    const list = items.filter((p) => showArchived || !archived.has(p.id));
    const total = list.length;
    const invValue = list.reduce((s, p) => s + (Number(p.qty_in_stock) * Number(p.cost_price ?? 0)), 0);
    const potential = list.reduce((s, p) => s + (Number(p.qty_in_stock) * Number(p.sell_price ?? 0)), 0);
    const low = list.filter(
      (p) => Number(p.alert_threshold ?? 0) > 0 && Number(p.qty_in_stock) <= Number(p.alert_threshold ?? 0)
    ).length;
    return { total, invValue, potential, low };
  }, [items, archived, showArchived]);

  const filtered = useMemo(() => {
    const s = qDebounced;
    let list = items.filter((p) => showArchived || !archived.has(p.id));
    if (s) {
      list = list.filter(
        (p) =>
          (p.name ?? "").toLowerCase().includes(s) ||
          (p.sku ?? "").toLowerCase().includes(s) ||
          (p.category ?? "").toLowerCase().includes(s)
      );
    }
    switch (sortBy) {
      case "name":
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "stock":
        list.sort((a, b) => Number(b.qty_in_stock) - Number(a.qty_in_stock));
        break;
      case "priceUp":
        list.sort((a, b) => Number(a.sell_price ?? 0) - Number(b.sell_price ?? 0));
        break;
      case "priceDown":
        list.sort((a, b) => Number(b.sell_price ?? 0) - Number(a.sell_price ?? 0));
        break;
      default:
        list.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    }
    return list;
  }, [items, archived, showArchived, qDebounced, sortBy]);

  /* --------------------------- actions --------------------------- */
  function validateForm(): string | null {
    if (!form.name || !String(form.name).trim()) return "Product name is required.";
    if (form.sell_price == null || isNaN(Number(form.sell_price))) return "Sell price is required.";
    if (Number(form.sell_price) < 0) return "Sell price cannot be negative.";
    if (form.cost_price != null && Number(form.cost_price) < 0) return "Cost price cannot be negative.";
    if (form.qty_in_stock != null && Number(form.qty_in_stock) < 0) return "Stock quantity cannot be negative.";
    if (form.alert_threshold != null && Number(form.alert_threshold) < 0) return "Alert threshold cannot be negative.";
    return null;
  }

  function onSave() {
    setErr("");
    setNote("");

    // Cap guard: count only non-archived products
    if (activeCount >= productCap) {
      setErr(
        `Product limit reached for the ${plan.toUpperCase()} plan. (${activeCount}/${productCap}). ` +
        `Archive old items or upgrade to add more.`
      );
      return;
    }

    const v = validateForm();
    if (v) {
      setErr(v);
      return;
    }

    try {
      addProduct({
        name: String(form.name),
        sku: form.sku || undefined,
        category: form.category || undefined,
        cost_price: Number(form.cost_price || 0),
        sell_price: Number(form.sell_price || 0),
        qty_in_stock: Number(form.qty_in_stock || 0),
        alert_threshold: Number(form.alert_threshold || 0),
      });

      setForm({
        name: "",
        sku: "",
        category: "",
        cost_price: 0,
        sell_price: 0,
        qty_in_stock: 0,
        alert_threshold: 0,
      });

      setNote("Saved ✓");
      setTimeout(() => setNote(""), 900);
      refresh();
    } catch (e: any) {
      setErr(e?.message || "Error while saving product.");
    }
  }

  function archive(id: string) {
    const s = new Set(archived);
    s.add(id);
    setArchived(s);
    writeSet(ARCH_KEY, s);
  }
  function restore(id: string) {
    const s = new Set(archived);
    s.delete(id);
    setArchived(s);
    writeSet(ARCH_KEY, s);
  }

  async function onDelete(p: Product) {
    if (!admin) return;
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      deleteProduct(p.id); // core may throw if referenced
      refresh();
    } catch (e: any) {
      const msg = String(e?.message || "").toLowerCase();
      alert(e?.message || "Failed to delete product");
      // Optional auto-archive fallback if core blocks delete:
      if (msg.includes("cannot delete") || msg.includes("no record") || msg.includes("referenced")) {
        archive(p.id);
      }
    }
  }

  /* ----------------------------- UI ------------------------------ */
  return (
    <div className="grid gap-6">
      {/* KPIs */}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="kpi-tile">
            <div className="text-sm muted">Total Products</div>
            <div className="kpi-value ok">{kpis.total}</div>
          </div>
          <div className="kpi-tile">
            <div className="text-sm muted">Inventory Value</div>
            <div className="kpi-value ok">{money(kpis.invValue)}</div>
          </div>
          <div className="kpi-tile">
            <div className="text-sm muted">Potential Revenue</div>
            <div className="kpi-value ok">{money(kpis.potential)}</div>
          </div>
          <div className="kpi-tile">
            <div className="text-sm muted">Low-stock Items</div>
            <div className="kpi-value bad">{kpis.low}</div>
          </div>
          {/* Cap meter */}
          <div className="kpi-tile">
            <div className="flex items-center justify-between text-sm muted">
              <span>Products Cap</span>
              <span className="opacity-80">{activeCount}/{productCap}</span>
            </div>
            <div className="h-2 mt-2 rounded bg-[var(--line)]/40 overflow-hidden">
              <div
                className={`h-full ${capRatio < 0.85 ? "bg-green-500/80" : capRatio < 1 ? "bg-yellow-500/80" : "bg-red-500/80"}`}
                style={{ width: `${capRatio * 100}%` }}
              />
            </div>
            {activeCount >= productCap && (
              <div className="mt-2 text-xs text-[var(--bad)]">
                Limit reached — archive items or upgrade.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Add product */}
      <Card>
        <h2 className="mb-4 text-xl font-bold">Add Product</h2>
        <div className="grid gap-4 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <InputRow label="Name">
              <input
                className="control"
                value={form.name || ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., iPhone case"
              />
            </InputRow>
          </div>
          <div className="sm:col-span-3">
            <InputRow label="SKU">
              <div className="flex gap-2">
                <input
                  className="control"
                  value={form.sku || ""}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="SKU"
                />
                {form.sku && (
                  <button className="btn-ghost shrink-0" onClick={() => copy(form.sku!)}>Copy</button>
                )}
              </div>
            </InputRow>
          </div>
          <div className="sm:col-span-4">
            <InputRow label="Category">
              <input
                className="control"
                value={form.category || ""}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Category"
                list="catList"
              />
              <datalist id="catList">
                {[...catSuggest].slice(0, 80).sort().map((v) => <option key={v} value={v} />)}
              </datalist>
            </InputRow>
          </div>

          <div className="sm:col-span-3">
            <InputRow label="Cost price">
              <div className="input-wrap">
                <span className="input-prefix">₦</span>
                <input
                  type="number"
                  className="control with-prefix"
                  value={form.cost_price ?? 0}
                  min={0}
                  step="0.01"
                  onChange={(e) => setForm((f) => ({ ...f, cost_price: +e.target.value }))}
                />
              </div>
            </InputRow>
          </div>
          <div className="sm:col-span-3">
            <InputRow label="Sell price">
              <div className="input-wrap">
                <span className="input-prefix">₦</span>
                <input
                  type="number"
                  className="control with-prefix"
                  value={form.sell_price ?? 0}
                  min={0}
                  step="0.01"
                  onChange={(e) => setForm((f) => ({ ...f, sell_price: +e.target.value }))}
                />
              </div>
            </InputRow>
          </div>
          <div className="sm:col-span-3">
            <InputRow label="Stock qty">
              <input
                type="number"
                className="control"
                value={form.qty_in_stock ?? 0}
                min={0}
                step="1"
                onChange={(e) => setForm((f) => ({ ...f, qty_in_stock: +e.target.value }))}
              />
            </InputRow>
          </div>
          <div className="sm:col-span-3">
            <InputRow label="Alert threshold">
              <input
                type="number"
                className="control"
                value={form.alert_threshold ?? 0}
                min={0}
                step="1"
                onChange={(e) => setForm((f) => ({ ...f, alert_threshold: +e.target.value }))}
              />
            </InputRow>
          </div>
        </div>

        {err && <p className="mt-2 err">{err}</p>}
        {note && <p className="mt-2 text-sm text-green-300">{note}</p>}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button onClick={onSave} disabled={activeCount >= productCap}>Save</Button>
          <button
            className="btn-ghost"
            onClick={() =>
              setForm({
                name: "",
                sku: "",
                category: "",
                cost_price: 0,
                sell_price: 0,
                qty_in_stock: 0,
                alert_threshold: 0,
              })
            }
          >
            Clear
          </button>
        </div>
      </Card>

      {/* List header */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center">
          <h2 className="text-lg font-semibold">Products</h2>
          <div className="flex flex-col gap-2 lg:ml-auto sm:flex-row sm:items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / SKU / category"
              className="control w-full sm:w-[280px]"
            />
            <select
              className="w-full select sm:w-auto"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="new">Newest</option>
              <option value="name">Name A–Z</option>
              <option value="stock">Stock: High → Low</option>
              <option value="priceDown">Price: High → Low</option>
              <option value="priceUp">Price: Low → High</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span className="muted">Show archived</span>
            </label>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="grid gap-3 md:hidden">
          {filtered.length === 0 ? (
            <div className="py-3 text-center muted">No products.</div>
          ) : (
            filtered.map((p) => {
              const low =
                Number(p.alert_threshold ?? 0) > 0 &&
                Number(p.qty_in_stock) <= Number(p.alert_threshold ?? 0);
              const archivedFlag = archived.has(p.id);
              return (
                <div key={p.id} className="card">
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="font-bold">{p.name}</div>
                      <div className="text-sm muted">{p.category || "—"}</div>
                    </div>
                    <div className="font-extrabold text-right">{money(p.sell_price ?? 0)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className={`tag ${low ? "unpaid-pill" : "paid-pill"}`}>
                      Stock: {Number(p.qty_in_stock)}
                    </span>
                    {p.sku ? <span className="font-mono tag">SKU: {p.sku}</span> : null}
                    {archivedFlag && <span className="tag">Archived</span>}
                  </div>
                  <div className="mt-2 text-sm muted">
                    Margin:{" "}
                    <span className="text-[var(--ink)] font-semibold">
                      {money(Number(p.sell_price ?? 0) - Number(p.cost_price ?? 0))}
                    </span>{" "}
                    • Added {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                  </div>
                  <div className="flex gap-2 mt-3">
                    {p.sku && (
                      <button className="btn-ghost" onClick={() => copy(p.sku!)}>Copy SKU</button>
                    )}
                    {admin &&
                      (archivedFlag ? (
                        <button className="btn-ghost" onClick={() => restore(p.id)}>Restore</button>
                      ) : (
                        <>
                          <button className="btn-ghost" onClick={() => archive(p.id)}>Archive</button>
                          <button className="btn-ghost" onClick={() => onDelete(p)}>Delete</button>
                        </>
                      ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-auto md:block">
          <table className="w-full border-collapse text-[0.95rem]">
            <thead className="sticky top-0 bg-[#0f1722]">
              <tr className="text-left">
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Name</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">SKU</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Category</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Cost</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Sell</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Margin</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Stock</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Added</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Added by</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-3 text-center muted">
                    No products.
                  </td>
                </tr>
              ) : (
                filtered.map((p, i) => {
                  const low =
                    Number(p.alert_threshold ?? 0) > 0 &&
                    Number(p.qty_in_stock) <= Number(p.alert_threshold ?? 0);
                  const archivedFlag = archived.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-[var(--line)]/40 ${i % 2 === 0 ? "bg-[#0e1526]/30" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold">{p.name}</div>
                        {archivedFlag && <div className="inline-block mt-1 text-xs tag">Archived</div>}
                      </td>
                      <td className="px-3 py-2">
                        {p.sku ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{p.sku}</span>
                            <button className="btn-ghost" onClick={() => copy(p.sku!)}>Copy</button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">{p.category || "—"}</td>
                      <td className="px-3 py-2">{money(Number(p.cost_price ?? 0))}</td>
                      <td className="px-3 py-2 font-extrabold">{money(Number(p.sell_price ?? 0))}</td>
                      <td className="px-3 py-2">
                        {money(Number(p.sell_price ?? 0) - Number(p.cost_price ?? 0))}
                      </td>
                      <td className={`px-3 py-2 ${low ? "text-[var(--bad)] font-bold" : ""}`}>
                        {Number(p.qty_in_stock)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {p.createdBy ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-[var(--line)] flex items-center justify-center">
                              {getAvatar(p.createdBy.id) ? (
                                <img
                                  src={getAvatar(p.createdBy.id)!}
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <span className="text-[10px] opacity-70">
                                  {(p.createdBy.username || "").slice(0, 2).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <span className="text-xs">{p.createdBy.username}</span>
                            {p.createdBy.role && (
                              <span className="text-[10px] opacity-60 px-1 py-[1px] rounded border border-[var(--line)]">
                                {p.createdBy.role}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {admin &&
                            (archivedFlag ? (
                              <button className="btn-ghost" onClick={() => restore(p.id)}>Restore</button>
                            ) : (
                              <>
                                <button className="btn-ghost" onClick={() => archive(p.id)}>Archive</button>
                                <button className="btn-ghost" onClick={() => onDelete(p)}>Delete</button>
                              </>
                            ))}
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
    </div>
  );
}
