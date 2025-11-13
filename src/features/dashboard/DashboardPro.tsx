import { useEffect, useMemo, useState } from "react";
import {
  getTransactionsForDay,
  getSales,
  getSaleItems,
  getProducts,
  money,
  type SaleItem,
  getLicense,
  daysLeft,
} from "../../index";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";
import Button from "../../ui/Button";
import { Link } from "react-router-dom";

/* -------------------- local date helpers (no UTC drift) -------------------- */
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/* ----------------------------- tiny components ----------------------------- */
function SparkBars({
  series,
  height = 36,
  title,
}: { series: number[]; height?: number; title?: string }) {
  const max = Math.max(1, ...series);
  return (
    <div className="w-full h-full">
      {title && <div className="mb-1 text-xs muted">{title}</div>}
      <div className="flex items-end gap-[6px]" style={{ height }}>
        {series.map((v, i) => (
          <div
            key={i}
            title={String(v)}
            className="rounded bg-[#1a2944]"
            style={{ height: `${(v / max) * 100}%`, width: "10px" }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- types ---------------------------------- */
type RangeKey = "today" | "7d"; // 🔒 Free plan: no month view

interface Totals {
  income: number;
  orders: number;
  items: number;
  net: number;
}

/* ------------------------------- main page --------------------------------- */
export default function DashboardFree() {
  const lic = useMemo(() => getLicense(), []);
  const left = useMemo(() => daysLeft(lic), [lic]);

  const [today, setToday] = useState<string>(todayYMD());
  const [range, setRange] = useState<RangeKey>("today");
  const [pulse, setPulse] = useState<number>(0); // realtime refresh

  // storage heartbeat for cross-tab / live updates
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__") setPulse((p) => p + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* --------------------------- pull raw data once --------------------------- */
  const allSales = useMemo(() => getSales(), [pulse]);
  const allSaleItems = useMemo(() => getSaleItems(), [pulse]);
  const allProducts = useMemo(() => getProducts(), [pulse]);

  /* ------------------------------ period sets ------------------------------ */
  const periodDates = useMemo(() => {
    if (range === "today") return [today];
    // 7d
    return Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
  }, [today, range]);

  // sales & items within period
  const periodSaleIds = useMemo(() => {
    const dateSet = new Set(periodDates);
    return new Set(allSales.filter(s => dateSet.has(s.sold_on)).map(s => s.id));
  }, [periodDates, allSales]);

  const periodSaleItems = useMemo(() => {
    return allSaleItems.filter(it => periodSaleIds.has(it.sale_id));
  }, [allSaleItems, periodSaleIds]);

  // quick totals (Free: keep it simple)
  const totals: Totals = useMemo(() => {
    const orders = allSales.filter(s => periodSaleIds.has(s.id));
    const ordersCount = orders.length;
    const incomeFromSales = orders.reduce((sum, s) => sum + (s.total ?? 0), 0);

    // include quick income/expense from transactions for each day
    let incomeTx = 0;
    let expenseTx = 0;
    for (const d of periodDates) {
      const txs = getTransactionsForDay(d);
      incomeTx += txs.filter(t => t.kind === "income").reduce((s, t) => s + (t.amount || 0), 0);
      expenseTx += txs.filter(t => t.kind === "expense").reduce((s, t) => s + (t.amount || 0), 0);
    }

    const itemsCount = periodSaleItems.reduce((s, it) => s + (it.qty || 0), 0);
    const income = incomeFromSales + incomeTx;
    const net = income - expenseTx;
    return { income, orders: ordersCount, items: itemsCount, net };
  }, [allSales, periodSaleIds, periodSaleItems, periodDates, pulse]);

  // tiny series for spark
  const dayIncomeSeries = useMemo(() => {
    return periodDates.map(d => {
      const orders = allSales.filter(s => s.sold_on === d);
      const salesTotal = orders.reduce((sum, s) => sum + (s.total ?? 0), 0);
      const txs = getTransactionsForDay(d);
      const inc = txs.filter(t => t.kind === "income").reduce((s, t) => s + (t.amount || 0), 0);
      const exp = txs.filter(t => t.kind === "expense").reduce((s, t) => s + (t.amount || 0), 0);
      return Math.max(0, salesTotal + inc - exp);
    });
  }, [periodDates, allSales, pulse]);

  // Top 5 products (Free: keep to 5, name + qty only)
  const topProducts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of periodSaleItems) {
      const name = (it as SaleItem).name_snapshot || "Unnamed";
      counts[name] = (counts[name] || 0) + (it.qty || 0);
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));
  }, [periodSaleItems]);

  // Low stock count only (Free: no full table)
  const lowStockCount = useMemo(() => {
    return allProducts.filter(p => (p.alert_threshold ?? 0) > 0 && p.qty_in_stock <= (p.alert_threshold ?? 0)).length;
  }, [allProducts]);

  /* ---------------------------------- UI ----------------------------------- */
  const rangeTitle = range === "today" ? "Today" : "Last 7 Days";

  return (
    <div className="grid gap-6">
      {/* Upgrade strip / trial info */}
      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Dashboard <span className="opacity-70">— Free</span>
            </h1>
            <div className="text-sm muted">
              Basic insights. Upgrade for category mix, payment mix, customer leaderboard, exports & more.
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lic.expiresAt === 0 ? (
              <span className="badge">Free plan</span>
            ) : daysLeft(lic) > 0 ? (
              <span className="badge">Trial: {left} day(s) left</span>
            ) : (
              <span className="badge">Trial expired</span>
            )}
            <Link to="/settings">
              <Button>Go Pro</Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Header / Range chooser (Free: only Today / 7d) */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm muted">Range</div>
            <div className="mt-1 segment">
              <input id="r-today" type="radio" name="range" checked={range==="today"} onChange={()=>setRange("today")} />
              <label htmlFor="r-today">Today</label>
              <input id="r-7d" type="radio" name="range" checked={range==="7d"} onChange={()=>setRange("7d")} />
              <label htmlFor="r-7d">7 Days</label>
            </div>
          </div>

          {/* day picker */}
          <div className="flex items-center gap-2">
            <label className="label">Day</label>
            <input
              className="w-auto control"
              type="date"
              value={today}
              onChange={(e)=>setToday(e.target.value || todayYMD())}
            />
            <button className="btn-ghost" onClick={()=>setToday(todayYMD())}>Today</button>
          </div>
        </div>

        {/* KPIs (Free: 4 core metrics) */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Pill label="Income" value={money(totals.income)} color="ok" />
          <Pill label="Net" value={money(totals.net)} color={totals.net >= 0 ? "ok" : "bad"} />
          <Pill label="Orders" value={String(totals.orders)} color="ok" />
          <Pill label="Items Sold" value={String(totals.items)} color="ok" />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Link to="/sales"><Button>Sell Now</Button></Link>
          <Link to="/transactions"><Button variant="ghost">Record Quick Sale</Button></Link>
          <Link to="/products"><Button variant="ghost">Add Product</Button></Link>
          <Link to="/reports"><Button variant="ghost">Reports</Button></Link>

          {/* Free: no CSV export buttons */}
          <div className="ml-auto text-xs muted">
            Need CSV exports & advanced analytics? <Link to="/settings" className="link">Upgrade</Link>.
          </div>
        </div>
      </Card>

      {/* Trends (Free: single Net sparkbar) */}
      <Card>
        <h2 className="mb-3 text-lg font-bold">{rangeTitle} Trend</h2>
        <div className="grid gap-4 md:grid-cols-1">
          <div className="kpi-tile">
            <SparkBars series={dayIncomeSeries.map(v => Math.round(v))} title="Net (sales + income − expense)" />
          </div>
        </div>
      </Card>

      {/* Top products (Free: simple list) & Inventory summary (counts only) */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Top Products {range === "today" ? "(today)" : "(last 7 days)"}</h2>
          {topProducts.length === 0 ? (
            <div className="muted">No sales in this period.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <thead className="sticky top-0 bg-[#0f1722]">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Product</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((t, i) => (
                    <tr key={t.name} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2 font-extrabold">{t.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Inventory Snapshot</h2>
            <div className="badge">Free</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* Free: show counts, not money-heavy metrics */}
            <div className="kpi-tile">
              <div className="text-sm muted">Products</div>
              <div className="kpi-value ok">{allProducts.length}</div>
            </div>
            <div className="kpi-tile">
              <div className="text-sm muted">Low-stock Items</div>
              <div className="kpi-value bad">{lowStockCount}</div>
            </div>
            <div className="kpi-tile">
              <div className="text-sm muted">SKUs Sold (period)</div>
              <div className="kpi-value ok">
                {Array.from(new Set(periodSaleItems.map(it => it.product_id))).length}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs muted">
            Get inventory value, potential revenue & dead-stock reports on <Link to="/settings" className="link">Pro/Enterprise</Link>.
          </div>
        </Card>
      </div>
    </div>
  );
}
