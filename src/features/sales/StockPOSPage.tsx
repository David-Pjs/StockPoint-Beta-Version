import { useEffect, useMemo, useRef, useState } from "react";
import { getProducts, checkout, money, getLicense } from "../../index";
import type { Product, CartItem } from "../../index";
import Card from "../../ui/Card";
import InputRow from "../../ui/InputRow";
import Button from "../../ui/Button";

/* ---- plan caps ---- */
import { resolvePlanId } from "../../lib/plans";
import {
  checkAndConsume,
  readDay,
  getToday,
  type UsageDay,
} from "../../lib/usage";

/* ----------------------------- helpers ----------------------------- */
const CART_KEY = "sp_cart_draft:v2";
const HOLDS_KEY = "sp_cart_holds:v1";

type Hold = {
  id: string;
  name: string;
  ts: number;
  cart: CartItem[];
  discountValue: number;
  discountMode: "flat" | "percent";
  method: string | null;
};

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function pingRealtime() {
  try {
    localStorage.setItem("__sp_changed__", String(Date.now()));
  } catch {}
}

/* ------------------------------ page ------------------------------ */
export default function StockPOSPage() {
  // catalog
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [sortBy, setSortBy] = useState<"name" | "stock" | "price">("name");

  // cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountMode, setDiscountMode] = useState<"flat" | "percent">("flat");
  const [method, setMethod] = useState<string | null>(null);
  const [amountReceived, setAmountReceived] = useState<number | "">("");
  const [message, setMessage] = useState("");

  // holds
  const [holds, setHolds] = useState<Hold[]>([]);

  // caps & banners
  const [capBanner, setCapBanner] = useState<{ tone: "warn" | "error"; text: string } | null>(null);
  const [todayUsage, setTodayUsage] = useState<UsageDay>(() => readDay(getToday()));

  const searchRef = useRef<HTMLInputElement>(null);

  /* -------------------------- load / persist ------------------------- */
  useEffect(() => {
    refreshProducts();
    // draft cart
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setCart(d.cart || []);
        setDiscountValue(d.discountValue ?? 0);
        setDiscountMode(d.discountMode ?? "flat");
        setMethod(d.method ?? null);
      }
    } catch {}
    // holds
    try {
      const raw = localStorage.getItem(HOLDS_KEY);
      if (raw) setHolds(JSON.parse(raw));
    } catch {}

    // initial usage read
    setTodayUsage(readDay(getToday()));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ cart, discountValue, discountMode, method }));
    } catch {}
  }, [cart, discountValue, discountMode, method]);

  // live-sync usage (e.g., other tabs)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__") setTodayUsage(readDay(getToday()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // keyboard: "/" focus search, Enter adds top result
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !/input|textarea/i.test((e.target as any)?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Enter" && document.activeElement === searchRef.current) {
        if (visibleProducts[0]) addToCart(visibleProducts[0]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function refreshProducts() {
    setProducts(getProducts().sort((a, b) => a.name.localeCompare(b.name)));
  }

  /* ----------------------------- filters ---------------------------- */
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category && set.add(p.category));
    return ["all", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = products.filter((p) => {
      if (category !== "all" && (p.category || "") !== category) return false;
      if (onlyInStock && p.qty_in_stock <= 0) return false;
      if (!s) return true;
      return (
        (p.name ?? "").toLowerCase().includes(s) ||
        (p.sku ?? "").toLowerCase().includes(s) ||
        (p.category ?? "").toLowerCase().includes(s)
      );
    });
    if (sortBy === "stock") list.sort((a, b) => b.qty_in_stock - a.qty_in_stock);
    else if (sortBy === "price") list.sort((a, b) => (b.sell_price ?? 0) - (a.sell_price ?? 0));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, q, category, onlyInStock, sortBy]);

  // parse "2x sku" quick add (scanner-friendly)
  useEffect(() => {
    const m = q.match(/^(\d+)\s*[xX]\s*(.+)$/);
    if (m) {
      const qty = Math.max(1, parseInt(m[1], 10));
      const token = m[2].trim().toLowerCase();
      const hit =
        products.find((p) => (p.sku || "").toLowerCase() === token) ||
        products.find((p) => (p.name || "").toLowerCase() === token);
      if (hit) {
        addToCart(hit, qty);
        setQ("");
      }
    }
  }, [q]); // eslint-disable-line

  const visibleProducts = filtered.slice(0, 500);

  /* ----------------------------- cart ops --------------------------- */
  function maxAddable(prod: Product) {
    const inCart = cart.find((ci) => ci.product.id === prod.id)?.qty || 0;
    return Math.max(0, prod.qty_in_stock - inCart);
  }

  function addToCart(prod: Product, by = 1) {
    const cap = maxAddable(prod);
    if (cap <= 0) {
      toast(`Out of stock for "${prod.name}"`);
      return;
    }
    const addQty = Math.min(cap, by);
    setCart((curr) => {
      const idx = curr.findIndex((ci) => ci.product.id === prod.id);
      if (idx !== -1) {
        const next = [...curr];
        next[idx] = { ...next[idx], qty: next[idx].qty + addQty };
        return next;
      }
      return [...curr, { product: prod, qty: addQty, price: prod.sell_price }];
    });
  }

  function updateQty(prodId: string, qty: number) {
    setCart((curr) =>
      curr.map((ci) =>
        ci.product.id === prodId
          ? { ...ci, qty: Math.max(1, Math.min(qty, ci.product.qty_in_stock)) }
          : ci
      )
    );
  }

  function overridePrice(prodId: string, price: number) {
    setCart((curr) => curr.map((ci) => (ci.product.id === prodId ? { ...ci, price: Math.max(0, price) } : ci)));
  }

  function removeItem(prodId: string) {
    setCart((curr) => curr.filter((ci) => ci.product.id !== prodId));
  }

  function clearCart() {
    setCart([]);
    setDiscountValue(0);
    setDiscountMode("flat");
    setMethod(null);
    setAmountReceived("");
  }

  /* ---------------------------- totals math ------------------------- */
  const subtotal = useMemo(
    () => cart.reduce((s, ci) => s + ci.qty * (ci.price ?? ci.product.sell_price), 0),
    [cart]
  );
  const discountAmount = useMemo(() => {
    if (!discountValue) return 0;
    return discountMode === "flat" ? Math.min(discountValue, subtotal) : Math.min((discountValue / 100) * subtotal, subtotal);
  }, [discountValue, discountMode, subtotal]);

  const total = Math.max(0, subtotal - discountAmount);
  const changeDue = method === "cash" && amountReceived !== "" ? Math.max(0, Number(amountReceived) - total) : 0;

  /* --------------------------- holds (offline) ---------------------- */
  function saveHolds(next: Hold[]) {
    setHolds(next);
    try {
      localStorage.setItem(HOLDS_KEY, JSON.stringify(next));
    } catch {}
  }
  function holdSale() {
    if (cart.length === 0) return;
    const name = prompt("Name this hold (e.g., 'Mr Okoye / waiting')")?.trim();
    if (!name) return;
    const h: Hold = {
      id: String(Date.now()),
      name,
      ts: Date.now(),
      cart,
      discountValue,
      discountMode,
      method,
    };
    saveHolds([h, ...holds]);
    clearCart();
    toast("Sale held");
  }
  function resumeHold(h: Hold) {
    setCart(h.cart);
    setDiscountValue(h.discountValue);
    setDiscountMode(h.discountMode);
    setMethod(h.method);
    saveHolds(holds.filter((x) => x.id !== h.id));
  }
  function discardHold(id: string) {
    if (!confirm("Discard this held sale?")) return;
    saveHolds(holds.filter((x) => x.id !== id));
  }

  /* ---------------------------- checkout (caps) ---------------------------- */
  async function handleCheckout() {
    try {
      if (!cart.length) return;

      // CAP: one "quickSale" unit per checkout (matches your existing semantics)
      const planId = resolvePlanId(getLicense().plan);
      const res = checkAndConsume(planId, "quickSale", 1);

      if (!res.allowed && res.hardBlocked) {
        setCapBanner({ tone: "error", text: res.banner?.message || "Plan limit reached." });
        return;
      }
      if (res.allowed && res.banner) {
        setCapBanner({ tone: "warn", text: res.banner.message });
        // auto fade
        setTimeout(() => setCapBanner(null), 4000);
      }

      const iso = todayYMD(); // local-safe
      await checkout(cart, discountAmount, method || null, iso);

      clearCart();
      setMessage("Sale recorded ✓");
      setTimeout(() => setMessage(""), 2500);
      refreshProducts();
      pingRealtime();

      // refresh usage line (non-consuming read)
      setTodayUsage(readDay(getToday()));
    } catch (e: any) {
      alert(e.message || "Error");
    }
  }

  /* ------------------------------- UI -------------------------------- */
  function toast(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(""), 2000);
  }

  // pretty usage label
  const usageLine = useMemo(() => {
    const used = todayUsage.quickSale || 0;
    return `Sales today: ${used}`;
  }, [todayUsage.quickSale]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* -------- LEFT: Catalog -------- */}
      <Card className="flex flex-col">
        {/* Top bar: title + live usage + filters */}
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Products</h2>
            <div className="text-[12px] text-[var(--muted)] mt-0.5">{usageLine}</div>
          </div>

          <div className="w-full md:ml-auto">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  ref={searchRef}
                  className="w-full control pl-9"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name / SKU (tip: type '2x SKU' to add qty)"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">🔎</span>
              </div>

              <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "all" ? "All categories" : c}
                  </option>
                ))}
              </select>

              <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="name">A–Z</option>
                <option value="stock">Stock: High → Low</option>
                <option value="price">Price: High → Low</option>
              </select>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
                <span className="muted">In-stock only</span>
              </label>
            </div>

            {/* quick chips (visual only, doesn't change logic) */}
            <div className="flex flex-wrap gap-2 mt-2">
              {["Phone", "Food", "Gadget"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`px-2.5 py-1 rounded-full text-xs border border-[var(--line)] hover:border-slate-500 ${
                    category.toLowerCase() === chip.toLowerCase() ? "bg-[#1a2440]" : "bg-[#0e1526]/40"
                  }`}
                  onClick={() => setCategory(chip)}
                  title={`Filter by ${chip}`}
                >
                  {chip}
                </button>
              ))}
              <button
                type="button"
                className={`px-2.5 py-1 rounded-full text-xs border border-[var(--line)] hover:border-slate-500 ${
                  category === "all" ? "bg-[#1a2440]" : "bg-[#0e1526]/40"
                }`}
                onClick={() => setCategory("all")}
                title="Show all"
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* Optional cap banner */}
        {capBanner && (
          <div
            className={`mb-3 p-2.5 rounded-xl border ${
              capBanner.tone === "warn" ? "border-amber-400/40 bg-amber-500/10 text-amber-300" : "border-red-400/40 bg-red-500/10 text-red-300"
            }`}
          >
            {capBanner.text}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {visibleProducts.length === 0 ? (
            <div className="muted">No products match your search.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((prod) => {
                const cap = maxAddable(prod);
                const low =
                  (prod.alert_threshold ?? 0) > 0 && prod.qty_in_stock <= (prod.alert_threshold ?? 0);
                return (
                  <div
                    key={prod.id}
                    className={`p-3 rounded-2xl border border-[var(--line)]/70 bg-gradient-to-b from-[#0e1526]/50 to-[#0a1122]/50
                                hover:from-[#0f1931]/60 hover:to-[#0b1427]/60 transition-colors shadow-sm
                                ${cap <= 0 ? "opacity-60" : "cursor-pointer"}`}
                    onClick={() => cap > 0 && addToCart(prod)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{prod.name}</div>
                        <div className="text-[11px] muted truncate">
                          {prod.category || "—"}
                          {prod.sku ? ` • ${prod.sku}` : ""}
                        </div>
                      </div>
                      {low && <span className="badge">Low</span>}
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="font-extrabold">{money(prod.sell_price)}</div>
                      <div className="text-xs muted">Stock: {prod.qty_in_stock}</div>
                    </div>

                    <div className="h-1.5 mt-2 rounded-full bg-[#111a30] overflow-hidden">
                      <div
                        className="h-full bg-[#2dd4bf]"
                        style={{ width: `${Math.min(100, Math.max(0, prod.qty_in_stock))}%` }}
                        aria-hidden
                      />
                    </div>

                    <div className="flex gap-2 mt-2">
                      <button
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(prod, 1);
                        }}
                      >
                        +1
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(prod, 5);
                        }}
                      >
                        +5
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(prod, 10);
                        }}
                      >
                        +10
                      </button>
                    </div>

                    {cap <= 0 && <div className="mt-2 text-xs text-[var(--bad)]">Out of stock</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* -------- RIGHT: Cart -------- */}
      <Card className="flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold tracking-tight">Cart</h2>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={holdSale} disabled={!cart.length}>
              Hold
            </button>
            <button className="btn-ghost" onClick={clearCart} disabled={!cart.length}>
              Clear
            </button>
          </div>
        </div>

        {message && <p className="mb-2 text-sm text-emerald-300">{message}</p>}

        {/* Holds list */}
        {holds.length > 0 && (
          <div className="mb-3 p-2 rounded-xl border border-[var(--line)] bg-[#0e1526]/40">
            <div className="mb-2 text-sm font-semibold">Held Sales</div>
            <div className="flex flex-wrap gap-2">
              {holds.map((h) => (
                <div key={h.id} className="flex items-center gap-2 chip">
                  <span className="font-semibold">{h.name}</span>
                  <button className="btn-ghost" onClick={() => resumeHold(h)}>
                    Resume
                  </button>
                  <button className="btn-ghost" onClick={() => discardHold(h.id)}>
                    Discard
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {cart.length === 0 ? (
          <p className="text-sm muted">Cart is empty. Select products to add.</p>
        ) : (
          <div className="flex flex-col flex-1 gap-2">
            {cart.map((ci) => {
              const base = ci.product.sell_price ?? 0;
              const overridden = (ci.price ?? base) !== base;
              return (
                <div
                  key={ci.product.id}
                  className="border border-[var(--line)] rounded-xl p-2 grid grid-cols-12 gap-2 items-center bg-[#0b1326]/40"
                >
                  <div className="col-span-5 sm:col-span-4">
                    <div className="font-medium truncate">{ci.product.name}</div>
                    <div className="text-[11px] muted">
                      {ci.product.sku || "—"} • Stock {ci.product.qty_in_stock}
                    </div>
                  </div>

                  <div className="col-span-3 sm:col-span-2">
                    <div className="flex items-center gap-1">
                      <button className="px-2 py-1 bg-[#20304f] rounded" onClick={() => updateQty(ci.product.id, ci.qty - 1)}>
                        -
                      </button>
                      <input
                        className="w-12 px-1 py-1 rounded border border-[var(--line)] bg-[#0c1229] text-center"
                        type="number"
                        min={1}
                        max={ci.product.qty_in_stock}
                        value={ci.qty}
                        onChange={(e) => updateQty(ci.product.id, +e.target.value)}
                      />
                      <button className="px-2 py-1 bg-[#20304f] rounded" onClick={() => updateQty(ci.product.id, ci.qty + 1)}>
                        +
                      </button>
                    </div>
                  </div>

                  <div className="col-span-4 sm:col-span-3">
                    <div className="input-wrap">
                      <span className="input-prefix">₦</span>
                      <input
                        className={`control with-prefix ${overridden ? "ring-1 ring-[var(--ok)]" : ""}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={ci.price ?? base}
                        onChange={(e) => overridePrice(ci.product.id, +e.target.value)}
                        title="Override price"
                      />
                    </div>
                    {overridden && <div className="text-[10px] text-[var(--ok)] mt-1">override from {money(base)}</div>}
                  </div>

                  <div className="col-span-3 font-extrabold sm:col-span-2">{money((ci.price ?? base) * ci.qty)}</div>

                  <div className="col-span-12 sm:col-span-1">
                    <button className="text-sm text-red-400" onClick={() => removeItem(ci.product.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="border-t border-[var(--line)] pt-3 mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <InputRow label="Discount">
                  <div className="flex items-center gap-2">
                    <div className="segment">
                      <input id="d-flat" type="radio" name="disc" checked={discountMode === "flat"} onChange={() => setDiscountMode("flat")} />
                      <label htmlFor="d-flat">₦</label>
                      <input id="d-pct" type="radio" name="disc" checked={discountMode === "percent"} onChange={() => setDiscountMode("percent")} />
                      <label htmlFor="d-pct">%</label>
                    </div>
                    <input
                      type="number"
                      className="control w-28"
                      value={discountValue}
                      min={0}
                      step="0.01"
                      onChange={(e) => setDiscountValue(+e.target.value)}
                      placeholder="0"
                    />
                    {discountAmount > 0 && <span className="text-xs muted">save {money(discountAmount)}</span>}
                  </div>
                </InputRow>

                <InputRow label="Payment method">
                  <select value={method || ""} onChange={(e) => setMethod(e.target.value || null)} className="select">
                    <option value="">Select</option>
                    <option value="cash">Cash</option>
                    <option value="transfer">Transfer</option>
                    <option value="POS">POS</option>
                  </select>
                </InputRow>
              </div>

              {method === "cash" && (
                <InputRow label="Amount received">
                  <div className="input-wrap">
                    <span className="input-prefix">₦</span>
                    <input
                      type="number"
                      className="w-40 control with-prefix"
                      value={amountReceived === "" ? "" : Number(amountReceived)}
                      onChange={(e) => setAmountReceived(e.target.value === "" ? "" : +e.target.value)}
                      min={0}
                      step="0.01"
                    />
                  </div>
                  <div className="mt-1 text-sm">
                    Change: <span className="font-semibold">{money(changeDue)}</span>
                  </div>
                </InputRow>
              )}

              <div className="grid grid-cols-2 gap-2 font-medium">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{money(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>-{money(discountAmount)}</span>
                </div>
                <div className="flex justify-between col-span-2 text-lg font-extrabold">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCheckout}>Checkout</Button>
                <button className="btn-ghost" onClick={holdSale} disabled={!cart.length}>
                  Hold
                </button>
                <button className="btn-ghost" onClick={clearCart} disabled={!cart.length}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* sticky mobile summary */}
        {cart.length > 0 && (
          <div className="fixed left-0 right-0 px-4 md:hidden bottom-2">
            <div className="mx-auto max-w-[720px] rounded-2xl border border-[var(--line)] bg-[#0f1722]/95 backdrop-blur p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm muted">Total</div>
                <div className="text-lg font-extrabold">{money(total)}</div>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="w-full btn" onClick={handleCheckout}>
                  Checkout
                </button>
                <button className="w-full btn-ghost" onClick={holdSale}>
                  Hold
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
