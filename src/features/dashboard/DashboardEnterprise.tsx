import { useEffect, useMemo, useState } from "react";
import {
  getTransactionsForDay,
  getTransactionsForMonth,
  getSales,
  getSaleItems,
  getProducts,
  money,
  type SaleItem,
} from "../../index";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";
import Button from "../../ui/Button";
import { Link } from "react-router-dom";

/* -------------------- local time helpers (no UTC drift) -------------------- */
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdParts(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}
function monthKeyFromYMD(ymd: string) { return ymd.slice(0, 7); }
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function addDays(ymd: string, delta: number) {
  const { y, m, d } = ymdParts(ymd);
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

function Progress({ value, max, title }: { value: number; max: number; title?: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div>
      {title && <div className="mb-1 text-xs muted">{title}</div>}
      <div className="w-full h-2 rounded bg-[#101829] border border-[var(--line)]">
        <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Delta({ v }: { v: number }) {
  const up = v >= 0;
  return (
    <span className={`ml-2 text-[0.8rem] ${up ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/* ---------------------------------- types ---------------------------------- */
type RangeKey = "today" | "7d" | "month";
interface Totals {
  income: number;
  expense: number;
  net: number;
  orders: number;
  items: number;
  aov: number;
}

/* ------------------------------- CSV helpers ------------------------------- */
function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (s: string | number) => {
    const str = String(s ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------- main page --------------------------------- */
export default function DashboardEnterprise() {
  const [today, setToday] = useState<string>(todayYMD());
  const [range, setRange] = useState<RangeKey>("today");
  const [monthKey, setMonthKey] = useState<string>(monthKeyFromYMD(today));
  const [pulse, setPulse] = useState<number>(0); // realtime refresh
  const [compare, setCompare] = useState<boolean>(true); // compare with previous period

  // cross-tab heartbeat
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "__sp_changed__") setPulse(p => p + 1); };
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
    if (range === "7d") return Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    const { y, m } = ymdParts(`${monthKey}-01`);
    const count = daysInMonth(y, m);
    return Array.from({ length: count }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
  }, [today, range, monthKey]);

  const prevPeriodDates = useMemo(() => {
    if (!compare) return [];
    if (range === "today") return [addDays(today, -1)];
    if (range === "7d") return Array.from({ length: 7 }, (_, i) => addDays(today, -13 + i));
    // previous month
    const { y, m } = ymdParts(`${monthKey}-01`);
    const prev = new Date(y, m - 2, 1);
    const cnt = daysInMonth(prev.getFullYear(), prev.getMonth() + 1);
    const mk = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    return Array.from({ length: cnt }, (_, i) => `${mk}-${String(i + 1).padStart(2, "0")}`);
  }, [today, range, monthKey, compare]);

  // helpers to build summaries for a list of dates
  function summarize(dates: string[]) {
    const dateSet = new Set(dates);
    const saleIds = new Set(allSales.filter(s => dateSet.has(s.sold_on)).map(s => s.id));
    const txByDay: Record<string, ReturnType<typeof getTransactionsForDay> | any[]> = {};
    if (range === "month" && dates.length > 10) {
      const mk = dates[0]?.slice(0, 7) || monthKey;
      const mt = getTransactionsForMonth(mk);
      for (const d of dates) txByDay[d] = [];
      mt.forEach(t => { if (txByDay[t.occurred_on]) txByDay[t.occurred_on].push(t); });
    } else {
      for (const d of dates) txByDay[d] = getTransactionsForDay(d);
    }

    const series = dates.map(d => {
      const daySales = allSales.filter(s => s.sold_on === d);
      const ordersCount = daySales.length;
      const salesTotal = daySales.reduce((s, a) => s + (a.total || 0), 0);

      const itemsCount = allSaleItems.reduce((s, it) => {
        if (!saleIds.has(it.sale_id)) return s;
        const sale = daySales.find(sx => sx.id === it.sale_id);
        return sale ? s + (it.qty || 0) : s;
      }, 0);

      const txs = txByDay[d] || [];
      const incomeTx = txs.filter((t: any) => t.kind === "income").reduce((s: number, t: any) => s + (t.amount || 0), 0);
      const expenseTx = txs.filter((t: any) => t.kind === "expense").reduce((s: number, t: any) => s + (t.amount || 0), 0);

      const income = salesTotal + incomeTx;
      const expense = expenseTx;
      const net = income - expense;
      const aov = ordersCount ? income / ordersCount : 0;
      return { date: d, income, expense, net, orders: ordersCount, items: itemsCount, aov };
    });

    const totals = series.reduce(
      (acc, d) => {
        acc.income += d.income; acc.expense += d.expense; acc.net += d.net;
        acc.orders += d.orders; acc.items += d.items; return acc;
      },
      { income: 0, expense: 0, net: 0, orders: 0, items: 0 }
    );
    const aov = totals.orders ? totals.income / totals.orders : 0;
    return { series, totals: { ...totals, aov } as Totals, saleIds };
  }

  const current = useMemo(() => summarize(periodDates), [periodDates, allSales, allSaleItems]);
  const previous = useMemo(() => summarize(prevPeriodDates), [prevPeriodDates, allSales, allSaleItems]);

  // percent change helper
  function pctChange(now: number, prev: number) {
    if (!compare) return 0;
    if (prev === 0) return now > 0 ? 100 : 0;
    return ((now - prev) / Math.abs(prev)) * 100;
  }

  /* -------------------------- Enterprise deep dives ------------------------- */
  // Revenue by CATEGORY (from sale items -> product.category)
  const revByCategory = useMemo(() => {
    const byCat: Record<string, number> = {};
    const prodMap = new Map(getProducts().map(p => [p.id, p]));
    for (const it of allSaleItems) {
      if (!current.saleIds.has(it.sale_id)) continue;
      const p = prodMap.get(it.product_id);
      const cat = (p?.category || "Uncategorized").trim() || "Uncategorized";
      byCat[cat] = (byCat[cat] || 0) + (it.total || 0);
    }
    const entries = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0, 10);
    const sum = entries.reduce((s, [,v]) => s+v, 0) || 1;
    return entries.map(([k,v]) => ({ k, v, pct: (v/sum)*100 }));
  }, [current.saleIds, allSaleItems, pulse]);

  // Payment mix (Sales.method)
  const paymentMix = useMemo(() => {
    const by: Record<string, number> = {};
    for (const s of getSales()) {
      if (!current.saleIds.has(s.id)) continue;
      const m = (s.method || "Unspecified").toUpperCase();
      by[m] = (by[m] || 0) + (s.total || 0);
    }
    const entries = Object.entries(by).sort((a,b)=>b[1]-a[1]);
    const sum = entries.reduce((s, [,v]) => s+v, 0) || 1;
    return entries.map(([k,v]) => ({ k, v, pct: (v/sum)*100 }));
  }, [current.saleIds, pulse]);

  // Top customers (from transactions.income with customer_name)
  const topCustomers = useMemo(() => {
    const by: Record<string, number> = {};
    for (const d of periodDates) {
      const txs = getTransactionsForDay(d);
      txs.forEach(t => {
        if (t.kind !== "income") return;
        const name = (t.customer_name || "").trim();
        if (!name) return;
        by[name] = (by[name] || 0) + (t.amount || 0);
      });
    }
    return Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0, 10)
      .map(([name, total]) => ({ name, total }));
  }, [periodDates, pulse]);

  // SKU velocity (qty) in period
  const skuVelocity = useMemo(() => {
    const by: Record<string, number> = {};
    for (const it of allSaleItems) {
      if (!current.saleIds.has(it.sale_id)) continue;
      by[it.product_id] = (by[it.product_id] || 0) + (it.qty || 0);
    }
    const prodMap = new Map(getProducts().map(p => [p.id, p]));
    return Object.entries(by)
      .map(([pid, qty]) => ({ pid, qty, name: prodMap.get(pid)?.name || "Unknown", sku: prodMap.get(pid)?.sku || "" }))
      .sort((a,b)=>b.qty-a.qty)
      .slice(0, 10);
  }, [current.saleIds, allSaleItems, pulse]);

  // Dead stock candidates (in stock but not sold in period)
  const deadStock = useMemo(() => {
    const soldIds = new Set<string>();
    for (const it of allSaleItems) if (current.saleIds.has(it.sale_id)) soldIds.add(it.product_id);
    return getProducts()
      .filter(p => (p.qty_in_stock || 0) > 0 && !soldIds.has(p.id))
      .sort((a,b)=> (b.qty_in_stock - a.qty_in_stock))
      .slice(0, 10);
  }, [current.saleIds, allSaleItems, pulse]);

  /* --------------------------------- exports -------------------------------- */
  function exportSalesSummaryCSV() {
    const rows: (string | number)[][] = [["Date","Orders","Items","Income (₦)","Expense (₦)","Net (₦)","AOV (₦)"]];
    current.series.forEach(d => rows.push([d.date, d.orders, d.items, d.income.toFixed(2), d.expense.toFixed(2), d.net.toFixed(2), d.aov.toFixed(2)]));
    const label = range === "month" ? monthKey : `${range}-${today}`;
    downloadCSV(`enterprise-summary-${label}.csv`, rows);
  }
  function exportLineItemsCSV() {
    const prodMap = new Map(getProducts().map(p => [p.id, p]));
    const rows: (string | number)[][] = [["Sold On","Product","SKU","Category","Unit Price","Qty","Line Total","Sale ID"]];
    for (const it of allSaleItems) {
      if (!current.saleIds.has(it.sale_id)) continue;
      const sale = getSales().find(s => s.id === it.sale_id);
      const p = prodMap.get(it.product_id);
      rows.push([
        sale?.sold_on || "",
        it.name_snapshot || p?.name || "",
        p?.sku || "",
        p?.category || "",
        (it.unit_price || 0).toFixed(2),
        it.qty || 0,
        (it.total || 0).toFixed(2),
        it.sale_id,
      ]);
    }
    const label = range === "month" ? monthKey : `${range}-${today}`;
    downloadCSV(`enterprise-line-items-${label}.csv`, rows);
  }

  /* ---------------------------------- UI ----------------------------------- */
  const rangeTitle =
    range === "today"
      ? "Today"
      : range === "7d"
      ? "Last 7 Days"
      : new Date(ymdParts(`${monthKey}-01`).y, ymdParts(`${monthKey}-01`).m - 1, 1).toLocaleString(undefined, {
          month: "long",
          year: "numeric",
        });

  function prevMonth() {
    const { y, m } = ymdParts(`${monthKey}-01`);
    const dt = new Date(y, m - 2, 1);
    setMonthKey(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  function nextMonth() {
    const { y, m } = ymdParts(`${monthKey}-01`);
    const dt = new Date(y, m, 1);
    setMonthKey(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }

  const cur = current.totals;
  const prev = previous.totals;

  return (
    <div className="grid gap-6">
      {/* Header / Range chooser */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Dashboard <span className="opacity-70">- Enterprise</span></h1>
            <div className="text-sm muted">Advanced analytics, mixes & leaderboards for serious operations.</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="segment">
              <input id="r-today" type="radio" name="range" checked={range==="today"} onChange={()=>setRange("today")} />
              <label htmlFor="r-today">Today</label>
              <input id="r-7d" type="radio" name="range" checked={range==="7d"} onChange={()=>setRange("7d")} />
              <label htmlFor="r-7d">7 Days</label>
              <input id="r-month" type="radio" name="range" checked={range==="month"} onChange={()=>setRange("month")} />
              <label htmlFor="r-month">This Month</label>
            </div>

            {range === "month" && (
              <div className="flex items-center gap-2">
                <button className="btn-ghost" onClick={prevMonth}>←</button>
                <div className="badge">{rangeTitle}</div>
                <button className="btn-ghost" onClick={nextMonth}>→</button>
              </div>
            )}

            {/* day picker */}
            {range !== "month" && (
              <div className="flex items-center gap-2">
                <label className="label">Day</label>
                <input className="w-auto control" type="date" value={today} onChange={(e)=>setToday(e.target.value || todayYMD())}/>
                <button className="btn-ghost" onClick={()=>setToday(todayYMD())}>Today</button>
              </div>
            )}

            {/* compare toggle */}
            <label className="inline-flex items-center gap-2 ml-2 text-sm">
              <input type="checkbox" checked={compare} onChange={(e)=>setCompare(e.target.checked)} />
              Compare to previous period
            </label>
          </div>
        </div>

        {/* KPIs with delta */}
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Pill label="Income"   value={`${money(cur.income)}${compare ? "" : ""}`} color="ok" />
          <div className="flex items-center"><Pill label="Expenses" value={money(cur.expense)} color="bad" /><Delta v={pctChange(cur.expense, prev.expense)} /></div>
          <div className="flex items-center"><Pill label="Net" value={money(cur.net)} color={cur.net>=0?"ok":"bad"} /><Delta v={pctChange(cur.net, prev.net)} /></div>
          <div className="flex items-center"><Pill label="Orders" value={String(cur.orders)} color="ok" /><Delta v={pctChange(cur.orders, prev.orders)} /></div>
          <div className="flex items-center"><Pill label="Items" value={String(cur.items)} color="ok" /><Delta v={pctChange(cur.items, prev.items)} /></div>
          <div className="flex items-center"><Pill label="AOV" value={money(cur.aov)} color="ok" /><Delta v={pctChange(cur.aov, prev.aov)} /></div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Link to="/sales"><Button>Sell Now</Button></Link>
          <Link to="/transactions"><Button variant="ghost">Record Quick Sale</Button></Link>
          <Link to="/products"><Button variant="ghost">Add Product</Button></Link>
          <Link to="/reports"><Button variant="ghost">Reports</Button></Link>
          <button className="btn-ghost" onClick={exportSalesSummaryCSV}>Export Summary CSV</button>
          <button className="btn-ghost" onClick={exportLineItemsCSV}>Export Line Items CSV</button>
        </div>
      </Card>

      {/* Trends */}
      <Card>
        <h2 className="mb-3 text-lg font-bold">{rangeTitle} Trends</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="kpi-tile"><SparkBars series={current.series.map(d => Math.round(d.income))} title="Income" /></div>
          <div className="kpi-tile"><SparkBars series={current.series.map(d => Math.round(d.expense))} title="Expenses" /></div>
          <div className="kpi-tile"><SparkBars series={current.series.map(d => Math.round(d.net))} title="Net" /></div>
        </div>
      </Card>

      {/* Mixes & Leaderboards */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Revenue by Category</h2>
          {revByCategory.length === 0 ? (
            <div className="muted">No sales in this period.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <thead className="sticky top-0 bg-[#0f1722]">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Category</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Revenue</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {revByCategory.map((r,i)=>(
                    <tr key={r.k} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{r.k}</td>
                      <td className="px-3 py-2 font-extrabold">{money(r.v)}</td>
                      <td className="px-3 py-2">{r.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold">Payment Method Mix</h2>
          {paymentMix.length === 0 ? (
            <div className="muted">No sales in this period.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <thead className="sticky top-0 bg-[#0f1722]">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Method</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Revenue</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMix.map((r,i)=>(
                    <tr key={r.k} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{r.k}</td>
                      <td className="px-3 py-2 font-extrabold">{money(r.v)}</td>
                      <td className="px-3 py-2">{r.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold">Top Customers</h2>
          {topCustomers.length === 0 ? (
            <div className="muted">No named customers recorded in this period.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <thead className="sticky top-0 bg-[#0f1722]">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Customer</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((c,i)=>(
                    <tr key={c.name} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 font-extrabold">{money(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold">SKU Velocity</h2>
          {skuVelocity.length === 0 ? (
            <div className="muted">No sales in this period.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <thead className="sticky top-0 bg-[#0f1722]">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Product</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">SKU</th>
                    <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {skuVelocity.map((r,i)=>(
                    <tr key={r.pid} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 font-mono">{r.sku || "—"}</td>
                      <td className="px-3 py-2 font-extrabold">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Inventory risk */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Dead-stock Candidates (in stock but not sold this period)</h2>
          <div className="badge">Attention</div>
        </div>
        {deadStock.length === 0 ? (
          <div className="muted">Great — everything that’s in stock moved this period.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Name</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">SKU</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">In Stock</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Alert</th>
                </tr>
              </thead>
              <tbody>
                {deadStock.map((p,i)=>(
                  <tr key={p.id} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 font-mono">{p.sku || "—"}</td>
                    <td className="px-3 py-2 font-extrabold">{p.qty_in_stock}</td>
                    <td className="px-3 py-2">{p.alert_threshold ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
