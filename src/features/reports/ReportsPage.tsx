// src/pages/reports/ReportsPage.tsx
import { useEffect, useMemo, useState } from "react";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";
import {
  getTransactionsForDay,
  getTransactionsForMonth,
  getSales,
  getSaleItems,
  setPaidFlag,
  getPaidMap,
  deleteTransaction,
  money,
  subscribeChanges,
  type Transaction,
  type Sale,
  type SaleItem,
} from "../../index";

/* ---------------- time helpers (local, no UTC drift) ---------------- */
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function monthKeyFromYMD(ymd: string) { return ymd.slice(0, 7); } // YYYY-MM
function addDays(ymd: string, delta: number) {
  const [y,m,d] = ymd.split("-").map(Number);
  const dt = new Date(y, m-1, d); dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const dd = String(dt.getDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

/* ---------------- tiny viz + csv helpers ---------------- */
function downloadCSV(filename: string, rows: (string|number)[][]) {
  const esc = (s: string|number) => {
    const str = String(s ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
  };
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- small helper UI bits ---------------- */
function plusMinusStr(x: number) {
  return x >= 0 ? `+${x}` : `${x}`;
}
function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}
function niceDateShort(d: string) {
  // expects YYYY-MM-DD
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------- Mini chart components (no libs) ------------------- */

/** LineChart: renders one or more series (shared x) as compact SVG line chart */
function LineChart({ width = 400, height = 88, series, colors, labels }: {
  width?: number; height?: number;
  series: number[][];
  colors?: string[];
  labels?: string[];
}) {
  // assume series share same length
  const n = series[0]?.length || 0;
  const max = Math.max(...series.flat(), 1);
  const min = Math.min(...series.flat(), 0);
  const pad = 6;
  const w = Math.max(60, width);
  const h = height;
  const step = n > 1 ? ( (w - pad*2) / (n - 1) ) : 0;

  const norm = (v: number) => {
    const rng = max - min || 1;
    return pad + (1 - (v - min)/rng) * (h - pad*2);
  };

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      {/* grid lines */}
      <g opacity={0.06}>
        <line x1={pad} x2={w-pad} y1={pad} y2={pad} stroke="currentColor" />
        <line x1={pad} x2={w-pad} y1={h/2} y2={h/2} stroke="currentColor" />
        <line x1={pad} x2={w-pad} y1={h-pad} y2={h-pad} stroke="currentColor" />
      </g>

      {/* areas/lines */}
      {series.map((s, si) => {
        const color = colors?.[si] ?? (si === 0 ? "var(--spark)" : "rgba(255,255,255,0.18)");
        const d = s.map((v, i) => `${i===0 ? "M":"L"} ${pad + i*step} ${norm(v)}`).join(" ");
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            {/* subtle circles for points */}
            {s.map((v,i)=> <circle key={i} cx={pad + i*step} cy={norm(v)} r={1.6} fill={color} />)}
          </g>
        );
      })}
    </svg>
  );
}

/** DonutChart: simple percentage donut with center label */
function DonutChart({ size = 120, data, colors }: { size?: number; data: { label:string; value:number }[]; colors?: string[] }) {
  const total = Math.max(1, data.reduce((a,b)=>a+b.value, 0));
  let acc = 0;
  const r = (size/2) - 6;
  const cx = size/2, cy = size/2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {data.map((d, i) => {
        const v = d.value;
        const len = (v / total) * circumference;
        const offset = (acc / total) * circumference;
        acc += v;
        const stroke = colors?.[i] ?? (i===0 ? "var(--spark)" : `hsl(${(i*60)%360} 70% 50%)`);
        return (
          <circle key={i}
            r={r}
            cx={cx}
            cy={cy}
            fill="transparent"
            stroke={stroke}
            strokeWidth={12}
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: "stroke-dasharray .4s, stroke .2s" }}
            />
        );
      })}
      <circle r={r-10} cx={cx} cy={cy} fill="var(--table-bg)" stroke="transparent" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" style={{ fontWeight:700, fill: "var(--table-text)" }}>
        {data[0] ? `${Math.round((data[0].value/total)*100)}%` : "—"}
      </text>
    </svg>
  );
}

/** HorizontalBars: top products with bars scaled to max */
function HorizontalBars({ rows, maxWidth = 260 }: { rows: { label:string; value:number }[]; maxWidth?: number }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="text-sm truncate" style={{ minWidth: 90 }}>{r.label}</div>
          <div style={{ flex: 1 }} title={`${r.value}`}>
            <div style={{ height: 8, background: "var(--spark-track)", borderRadius: 8 }}>
              <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: "var(--spark)", borderRadius: 8 }} />
            </div>
          </div>
          <div className="ml-2 font-semibold" style={{ minWidth: 72, textAlign: "right" }}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

/** SparkBars: small vertical bars — uses CSS var --spark if available */
function SparkBars({ series, height = 36, title }: { series: number[]; height?: number; title?: string }) {
  const max = Math.max(1, ...series);
  return (
    <div>
      {title && <div className="mb-1 text-xs text-slate-400">{title}</div>}
      <div className="flex items-end gap-[6px]" style={{ height }}>
        {series.map((v, i) => (
          <div key={i} title={`${v}`} className="rounded" style={{
            height: `${(v / max) * 100}%`,
            width: 10,
            background: "var(--spark, #1a2944)"
          }} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- types & state keys ---------------- */
type RangeKey = "today" | "7d" | "month" | "custom";

type DayRow = {
  date: string;
  income: number;
  expense: number;
  net: number;
  orders: number;
  items: number;
  discounts: number;
  aov: number;
};

/* ------------- persistent report preference helpers ------------- */

const REPORT_PREF_KEY = "sp_report_prefs:v1";

type ReportPrefs = {
  range: RangeKey;
  dayDate: string;
  monthKey: string;
  startDate: string;
  endDate: string;
  includeQuickTx: boolean;
};

function isValidYMD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isValidMonthKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
}
function isValidRangeKey(s: unknown): s is RangeKey {
  return s === "today" || s === "7d" || s === "month" || s === "custom";
}

function loadReportPrefs(): ReportPrefs | null {
  try {
    const raw = localStorage.getItem(REPORT_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportPrefs>;
    if (!isValidRangeKey(parsed.range)) return null;

    const fallbackToday = todayYMD();
    const fallbackMonth = monthKeyFromYMD(fallbackToday);

    const prefs: ReportPrefs = {
      range: parsed.range,
      dayDate: isValidYMD(parsed.dayDate) ? parsed.dayDate : fallbackToday,
      monthKey: isValidMonthKey(parsed.monthKey) ? parsed.monthKey : fallbackMonth,
      startDate: isValidYMD(parsed.startDate) ? parsed.startDate : addDays(fallbackToday, -6),
      endDate: isValidYMD(parsed.endDate) ? parsed.endDate : fallbackToday,
      includeQuickTx:
        typeof parsed.includeQuickTx === "boolean" ? parsed.includeQuickTx : true,
    };
    return prefs;
  } catch {
    return null;
  }
}

function saveReportPrefs(p: ReportPrefs) {
  try {
    localStorage.setItem(REPORT_PREF_KEY, JSON.stringify(p));
  } catch {
    // ignore – do not break UI
  }
}

export default function ReportsPage() {
  /* -------- range + options -------- */
  const [range, setRange] = useState<RangeKey>("today");
  const [dayDate, setDayDate] = useState<string>(todayYMD());
  const [monthKey, setMonthKey] = useState<string>(monthKeyFromYMD(todayYMD()));
  const [startDate, setStartDate] = useState<string>(addDays(todayYMD(), -6));
  const [endDate, setEndDate] = useState<string>(todayYMD());
  const [includeQuickTx, setIncludeQuickTx] = useState(true);

  // Load persisted report preferences once on mount
  useEffect(() => {
    const prefs = loadReportPrefs();
    if (!prefs) return;
    setRange(prefs.range);
    setDayDate(prefs.dayDate);
    setMonthKey(prefs.monthKey);
    setStartDate(prefs.startDate);
    setEndDate(prefs.endDate);
    setIncludeQuickTx(prefs.includeQuickTx);
  }, []);

  // Persist report preferences whenever they change
  useEffect(() => {
    const prefs: ReportPrefs = {
      range,
      dayDate,
      monthKey,
      startDate,
      endDate,
      includeQuickTx,
    };
    saveReportPrefs(prefs);
  }, [range, dayDate, monthKey, startDate, endDate, includeQuickTx]);

  /* -------- realtime pulse (cross-tab + same-tab) -------- */
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const cb = () => setPulse(p => p + 1);
    const off = subscribeChanges(cb);
    const onDom = () => cb();
    const onStorage = (e: StorageEvent) => { if (e.key === "__sp_changed__") cb(); };

    window.addEventListener("sp:changed", onDom);
    window.addEventListener("storage", onStorage);

    return () => {
      off();
      window.removeEventListener("sp:changed", onDom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* -------- paid map for actions -------- */
  const [paidMap, setPaidMapState] = useState<Record<string, boolean>>(() => getPaidMap());
  function refreshPaid() { setPaidMapState({ ...getPaidMap() }); }
  useEffect(() => { refreshPaid(); }, [pulse]);

  /* -------- date list for selected range -------- */
  const dates = useMemo(() => {
    if (range === "today") return [dayDate];
    if (range === "7d") return Array.from({length:7}, (_,i)=> addDays(dayDate, -6 + i));
    if (range === "month") {
      const [y,m] = monthKey.split("-").map(Number);
      const n = daysInMonth(y, m);
      return Array.from({length:n}, (_,i)=> `${monthKey}-${String(i+1).padStart(2,"0")}`);
    }
    // custom
    const out: string[] = [];
    let d = startDate;
    while (d <= endDate) { out.push(d); d = addDays(d, 1); }
    return out;
  }, [range, dayDate, monthKey, startDate, endDate]);

  /* -------- raw data pulls (minimal calls, then filter) -------- */
  const allSales = useMemo(() => getSales(), [pulse]);
  const allItems = useMemo(() => getSaleItems(), [pulse]);

  const saleItemsBySaleId = useMemo(() => {
    const map = new Map<string, SaleItem[]>();
    for (const it of allItems) {
      const arr = map.get(it.sale_id) ?? [];
      arr.push(it);
      map.set(it.sale_id, arr);
    }
    return map;
  }, [allItems]);

  const txByDate: Record<string, Transaction[]> = useMemo(() => {
    if (range === "month") {
      const monthTx = getTransactionsForMonth(monthKey);
      const map: Record<string, Transaction[]> = {};
      for (const d of dates) map[d] = [];
      for (const t of monthTx) { if (map[t.occurred_on]) map[t.occurred_on].push(t); }
      return map;
    } else {
      const map: Record<string, Transaction[]> = {};
      for (const d of dates) map[d] = getTransactionsForDay(d);
      return map;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, monthKey, dates, pulse]);

  /* -------- per-day series & totals -------- */
  const daySeries: DayRow[] = useMemo(() => {
    const dateSet = new Set(dates);
    const salesByDate = new Map<string, Sale[]>();
    dates.forEach(d => salesByDate.set(d, []));
    allSales.forEach(s => { if (dateSet.has(s.sold_on)) salesByDate.get(s.sold_on)!.push(s); });

    return dates.map(d => {
      const txs = txByDate[d] || [];
      const sales = salesByDate.get(d) || [];
      const orders = sales.length;
      const itemsCount = sales.reduce((sum, s) => {
        const items = saleItemsBySaleId.get(s.id) ?? [];
        return sum + items.reduce((siSum, it) => siSum + (it.qty || 0), 0);
      }, 0);
      const discounts = sales.reduce((s, o:any) => s + (o.discount ?? 0), 0);
      const salesTotal = sales.reduce((s, o:any) => s + (o.total ?? 0), 0);

      const incomeTx = includeQuickTx ? txs.filter(t => t.kind === "income").reduce((s, t) => s + t.amount, 0) : 0;
      const expenseTx = includeQuickTx ? txs.filter(t => t.kind === "expense").reduce((s, t) => s + t.amount, 0) : 0;

      const income = salesTotal + incomeTx;
      const expense = expenseTx;
      const net = income - expense;
      const aov = orders ? income / orders : 0;

      return { date: d, income, expense, net, orders, items: itemsCount, discounts, aov };
    });
  }, [dates, txByDate, allSales, saleItemsBySaleId, includeQuickTx]);

  const totals = useMemo(() => {
    const agg = daySeries.reduce((a, d) => {
      a.income += d.income; a.expense += d.expense; a.net += d.net;
      a.orders += d.orders; a.items += d.items; a.discounts += d.discounts;
      return a;
    }, { income:0, expense:0, net:0, orders:0, items:0, discounts:0 });
    const aov = agg.orders ? agg.income / agg.orders : 0;
    return { ...agg, aov };
  }, [daySeries]);

  /* -------- payment methods breakdown (sales + income tx) -------- */
  const methodBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of allSales) {
      if (!dates.includes(s.sold_on)) continue;
      const k = (s.method || "—").toLowerCase();
      map[k] = (map[k] || 0) + (s.total ?? 0);
    }
    if (includeQuickTx) {
      for (const d of dates) {
        for (const t of txByDate[d] || []) {
          if (t.kind !== "income") continue;
          const k = (t.method || "—").toLowerCase();
          map[k] = (map[k] || 0) + t.amount;
        }
      }
    }
    return Object.entries(map).sort((a,b)=> b[1]-a[1]);
  }, [allSales, dates, txByDate, includeQuickTx]);

  /* -------- top products in range -------- */
  const topProducts = useMemo(() => {
    const dateSet = new Set(dates);
    const ids = new Set(allSales.filter(s => dateSet.has(s.sold_on)).map(s => s.id));
    const counts: Record<string, number> = {};
    for (const it of allItems) {
      if (!ids.has(it.sale_id)) continue;
      const name = (it as SaleItem).name_snapshot || "Unnamed";
      counts[name] = (counts[name] || 0) + (it.qty || 0);
    }
    return Object.entries(counts).sort((a,b)=> b[1]-a[1]).slice(0,10)
      .map(([name, qty]) => ({ name, qty }));
  }, [allItems, allSales, dates]);

  /* -------- day ledger (only when single day selected) -------- */
  const isSingleDay = range === "today";
  const ledgerRows = useMemo(() => {
    if (!isSingleDay) return [];
    const d = dayDate;
    const sales = allSales.filter(s => s.sold_on === d);
    const txs = txByDate[d] || [];
    const merged = [
      ...sales.map(s => ({ type: "sale" as const, at: s.created_at, sale: s })),
      ...txs.map(t => ({ type: "tx" as const, at: t.created_at, tx: t })),
    ];
    return merged.sort((a,b)=> (a.at||0) - (b.at||0));
  }, [isSingleDay, allSales, txByDate, dayDate]);

  /* -------- period comparisons (previous period same length) -------- */
  const previousRange = useMemo(() => {
    if (range === "today") {
      const prev = addDays(dayDate, -1);
      return [prev];
    }
    if (range === "7d") {
      const start = addDays(dayDate, -13); // previous 7-day block before current
      return Array.from({length:7}, (_,i)=> addDays(start, i));
    }
    if (range === "month") {
      const [y,m] = monthKey.split("-").map(Number);
      const prevMonth = new Date(y, m-2, 1);
      const prevKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth()+1).padStart(2,"0")}`;
      const n = daysInMonth(prevMonth.getFullYear(), prevMonth.getMonth()+1);
      return Array.from({length:n}, (_,i)=> `${prevKey}-${String(i+1).padStart(2,"0")}`);
    }
    // custom: previous block same length directly before startDate
    const out: string[] = [];
    const len = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (24*3600*1000) + 1;
    for (let i = len; i > 0; i--) {
      const pd = addDays(startDate, -i);
      out.push(pd);
    }
    return out;
  }, [range, dayDate, monthKey, startDate, endDate]);

  const prevDaySeries: DayRow[] = useMemo(() => {
    const dateSet = new Set(previousRange);
    if (!previousRange.length) return [];
    const salesByDate = new Map<string, Sale[]>();
    previousRange.forEach(d => salesByDate.set(d, []));
    allSales.forEach(s => { if (dateSet.has(s.sold_on)) salesByDate.get(s.sold_on)!.push(s); });
    return previousRange.map(d => {
      const txs = txByDate[d] || []; // txByDate may still work if month mode; otherwise empty
      const sales = salesByDate.get(d) || [];
      const orders = sales.length;
      const itemsCount = sales.reduce((sum, s) => {
        const items = saleItemsBySaleId.get(s.id) ?? [];
        return sum + items.reduce((siSum, it) => siSum + (it.qty || 0), 0);
      }, 0);
      const discounts = sales.reduce((s, o:any) => s + (o.discount ?? 0), 0);
      const salesTotal = sales.reduce((s, o:any) => s + (o.total ?? 0), 0);
      const incomeTx = includeQuickTx ? txs.filter(t => t.kind === "income").reduce((s, t) => s + t.amount, 0) : 0;
      const expenseTx = includeQuickTx ? txs.filter(t => t.kind === "expense").reduce((s, t) => s + t.amount, 0) : 0;
      const income = salesTotal + incomeTx;
      const expense = expenseTx;
      const net = income - expense;
      const aov = orders ? income / orders : 0;
      return { date: d, income, expense, net, orders, items: itemsCount, discounts, aov };
    });
  }, [previousRange, allSales, saleItemsBySaleId, includeQuickTx, txByDate]);

  const prevTotals = useMemo(() => {
    const agg = prevDaySeries.reduce((a, d) => {
      a.income += d.income; a.expense += d.expense; a.net += d.net;
      a.orders += d.orders; a.items += d.items; a.discounts += d.discounts;
      return a;
    }, { income:0, expense:0, net:0, orders:0, items:0, discounts:0 });
    const aov = agg.orders ? agg.income / agg.orders : 0;
    return { ...agg, aov };
  }, [prevDaySeries]);

  /* -------- actions -------- */
  function togglePaid(id: string) { setPaidFlag(id, !paidMap[id]); refreshPaid(); }
  function removeTx(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    deleteTransaction(id); refreshPaid(); setPulse(p=>p+1);
  }
  function exportDailyCSV() {
    const rows: (string|number)[][] = [["Date","Orders","Items","Income","Expense","Net","AOV","Discounts"]];
    daySeries.forEach(d => rows.push([d.date,d.orders,d.items,d.income.toFixed(2),d.expense.toFixed(2),d.net.toFixed(2),d.aov.toFixed(2),d.discounts.toFixed(2)]));
    const label = range === "month" ? monthKey : range === "7d" ? `${addDays(dayDate,-6)}_to_${dayDate}` :
      range === "custom" ? `${startDate}_to_${endDate}` : dayDate;
    downloadCSV(`report-${label}.csv`, rows);
  }
  function exportLedgerCSV() {
    if (!isSingleDay) return;
    const rows: (string|number)[][] = [["Time","Kind","Amount","Description","Method/Ref"]];
    for (const r of ledgerRows) {
      if (r.type === "sale") {
        const s = r.sale!;
        rows.push([new Date(s.created_at).toLocaleTimeString(), "sale", (s.total ?? 0).toFixed(2),
          `Subtotal:${money(s.subtotal ?? 0)} Discount:${money(s.discount ?? 0)}`, s.method || "—"]);
      } else {
        const t = r.tx!;
        rows.push([new Date(t.created_at).toLocaleTimeString(), t.kind, t.amount.toFixed(2),
          t.description || "—", [t.method, t.reference].filter(Boolean).join(" • ") || "—"]);
      }
    }
    downloadCSV(`ledger-${dayDate}.csv`, rows);
  }

  /* -------- UI helpers for mobile condensed lists -------- */
  function MobileDailyCards() {
    return (
      <div className="flex flex-col gap-3">
        {daySeries.map(d => (
          <div key={d.date} className="p-3 rounded-lg bg-[#07132b] border border-[#10203a]">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{niceDateShort(d.date)}</div>
              <div className="text-xs text-slate-400">{d.orders} orders • {d.items} items</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div className="flex flex-col">
                <span className="text-xs muted">Income</span>
                <span className="font-semibold">{money(d.income)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs muted">Expenses</span>
                <span className="font-semibold">{money(d.expense)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs muted">Net</span>
                <span className="font-semibold">{money(d.net)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs muted">AOV</span>
                <span className="font-semibold">{money(d.aov)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* -------- UI -------- */
  const title =
    range === "today" ? "Today" :
    range === "7d" ? "Last 7 Days" :
    range === "month" ? `Month (${monthKey})` :
    `Custom (${startDate} → ${endDate})`;

  /* quick computed arrays for charts */
  const incomeSeries = daySeries.map(d => d.income);
  const expenseSeries = daySeries.map(d => d.expense);
  const netSeries = daySeries.map(d => d.net);
  const ordersSeries = daySeries.map(d => d.orders);
  const itemsSeries = daySeries.map(d => d.items);

  /* payment donut data */
  const paymentData = methodBreakdown.map(([k, v]) => ({ label: k.toUpperCase(), value: Math.round(v) }));

  /* top product rows */
  const topRows = topProducts.map(p => ({ label: p.name, value: p.qty }));

  /* percent changes vs previous period */
  const incomePct = pctChange(totals.income, prevTotals.income);
  const ordersPct = pctChange(totals.orders, prevTotals.orders);
  const netPct = pctChange(totals.net, prevTotals.net);

  return (
    <div className="grid gap-6">
      {/* Controls + KPIs */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Reports</h1>
            <div className="text-sm text-slate-400">Deep-dive analytics and exports — insights that help decisions.</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2 segment">
              <label className="inline-flex items-center gap-2">
                <input id="rg-today" type="radio" name="rg" checked={range==="today"} onChange={()=>setRange("today")} />
                <span className="text-sm">Today</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input id="rg-7d" type="radio" name="rg" checked={range==="7d"} onChange={()=>setRange("7d")} />
                <span className="text-sm">7 Days</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input id="rg-month" type="radio" name="rg" checked={range==="month"} onChange={()=>setRange("month")} />
                <span className="text-sm">This Month</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input id="rg-custom" type="radio" name="rg" checked={range==="custom"} onChange={()=>setRange("custom")} />
                <span className="text-sm">Custom</span>
              </label>
            </div>

            {range === "today" && (
              <div className="flex items-center gap-2 mt-2 md:mt-0">
                <label className="text-sm label">Day</label>
                <input className="w-auto control" type="date" value={dayDate} onChange={e=>setDayDate(e.target.value || todayYMD())}/>
                <button className="btn-ghost" onClick={()=>setDayDate(todayYMD())}>Today</button>
              </div>
            )}

            {range === "month" && (
              <div className="flex items-center gap-2 mt-2 md:mt-0">
                <label className="text-sm label">Month</label>
                <input className="w-auto control" type="month" value={monthKey} onChange={e=>setMonthKey(e.target.value || monthKey)} />
              </div>
            )}

            {range === "custom" && (
              <div className="flex items-center gap-2 mt-2 md:mt-0">
                <label className="text-sm label">From</label>
                <input className="w-auto control" type="date" value={startDate} onChange={e=>setStartDate(e.target.value || startDate)} />
                <label className="text-sm label">To</label>
                <input className="w-auto control" type="date" value={endDate} onChange={e=>setEndDate(e.target.value || endDate)} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeQuickTx} onChange={e=>setIncludeQuickTx(e.target.checked)} />
            <span className="text-slate-400">Include Quick Transactions</span>
          </label>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={exportDailyCSV}>Export {title} CSV</button>
            {isSingleDay && <button className="btn-ghost" onClick={exportLedgerCSV}>Export Day Ledger</button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <Pill label="Income" value={money(totals.income)} color="ok" />
          <Pill label="Expenses" value={money(totals.expense)} color="bad" />
          <Pill label="Net" value={money(totals.net)} color={totals.net >= 0 ? "ok" : "bad"} />
          <Pill label="Orders" value={String(totals.orders)} color="ok" />
          <Pill label="Items Sold" value={String(totals.items)} color="ok" />
          <Pill label="AOV" value={money(totals.aov)} color="ok" />
          <Pill label="Discounts" value={money(totals.discounts)} color="bad" />
        </div>

        {/* quick period comparison row */}
        <div className="flex items-center gap-3 mt-3 text-sm">
          <div className="text-slate-400">vs previous</div>
          <div className={`px-2 py-1 rounded ${incomePct >= 0 ? "bg-green-600/10" : "bg-red-600/10"}`}>
            Income {incomePct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(incomePct))}% ({money(prevTotals.income)})
          </div>
          <div className={`px-2 py-1 rounded ${ordersPct >= 0 ? "bg-green-600/10" : "bg-red-600/10"}`}>
            Orders {ordersPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(ordersPct))}% ({prevTotals.orders})
          </div>
          <div className={`px-2 py-1 rounded ${netPct >= 0 ? "bg-green-600/10" : "bg-red-600/10"}`}>
            Net {netPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(netPct))}% ({money(prevTotals.net)})
          </div>
        </div>
      </Card>

      {/* Trends: Line chart + small sparks */}
      <Card>
        <h2 className="mb-3 text-lg font-bold">{title} — Trends</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="kpi-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm muted">Income trend</div>
                <div className="font-bold">{money(totals.income)}</div>
              </div>
              <div style={{ width: 160 }}>
                <LineChart series={[incomeSeries]} colors={["var(--spark)"]} />
              </div>
            </div>
            <SparkBars series={incomeSeries} title="Daily income" />
          </div>

          <div className="kpi-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm muted">Expenses trend</div>
                <div className="font-bold">{money(totals.expense)}</div>
              </div>
              <div style={{ width: 160 }}>
                <LineChart series={[expenseSeries]} colors={["rgba(239,68,68,0.9)"]} />
              </div>
            </div>
            <SparkBars series={expenseSeries} title="Daily expense" />
          </div>

          <div className="kpi-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm muted">Net</div>
                <div className="font-bold">{money(totals.net)}</div>
              </div>
              <div style={{ width: 160 }}>
                <LineChart series={[netSeries]} colors={["var(--spark)"]} />
              </div>
            </div>
            <SparkBars series={netSeries} title="Daily net" />
          </div>
        </div>

        <div className="grid gap-4 mt-4 md:grid-cols-2">
          <div className="kpi-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm muted">Orders vs Items</div>
                <div className="font-bold">{totals.orders} orders</div>
              </div>
            </div>
            {/* simple stacked bars: orders & items as two series in a small line chart */}
            <LineChart series={[ordersSeries, itemsSeries]} colors={["var(--spark)", "rgba(255,255,255,0.22)"]} />
          </div>

          <div className="kpi-tile">
            <div className="flex items-start gap-3">
              <div style={{ width: 120 }}>
                <DonutChart size={120} data={paymentData.length ? paymentData.slice(0,3) : [{label:"—",value:1}]} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="text-sm muted">Payment methods</div>
                <div className="mt-2">
                  {paymentData.length === 0 ? <div className="text-slate-400">No payments</div> :
                    paymentData.map((p, i) => (
                      <div key={p.label} className="flex justify-between text-sm">
                        <div className="truncate">{p.label}</div>
                        <div className="font-semibold">{money(p.value)}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Payment Methods + Top Products */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Payment Methods (Sales {includeQuickTx ? "+ Quick Income" : ""})</h2>
          <div className="hidden md:block">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Method</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Amount</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Share</th>
                </tr>
              </thead>
              <tbody>
                {methodBreakdown.map(([m, amt], i) => {
                  const total = methodBreakdown.reduce((a, b) => a + b[1], 0) || 1;
                  const pct = Math.round((amt / total) * 100);
                  return (
                    <tr key={m} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{m.toUpperCase()}</td>
                      <td className="px-3 py-2 font-extrabold">{money(amt)}</td>
                      <td className="px-3 py-2">
                        <div style={{ width: 140 }}>
                          <div style={{ height: 8, background: "var(--spark-track)", borderRadius: 8 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: "var(--spark)", borderRadius: 8 }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!methodBreakdown.length && (
                  <tr><td colSpan={3} className="px-3 py-3 text-slate-400">No payments in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* mobile */}
          <div className="grid gap-2 md:hidden">
            {methodBreakdown.map(([m, amt]) => (
              <div key={m} className="p-3 rounded-lg bg-[#07132b] border border-[#10203a] flex justify-between items-center">
                <div className="text-sm font-medium">{m.toUpperCase()}</div>
                <div className="font-extrabold">{money(amt)}</div>
              </div>
            ))}
            {!methodBreakdown.length && <div className="text-slate-400">No payments in this range.</div>}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold">Top Products</h2>
          <div className="hidden md:block">
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
                {!topProducts.length && (
                  <tr><td colSpan={2} className="px-3 py-3 text-slate-400">No sales in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            <HorizontalBars rows={topRows} />
          </div>
        </Card>
      </div>

      {/* Daily table (always) */}
      <Card>
        <h2 className="mb-3 text-lg font-bold">{title} — Daily Summary</h2>

        <div className="md:hidden">
          <MobileDailyCards />
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="w-full border-collapse text-[0.95rem]">
            <thead className="sticky top-0 bg-[#0f1722]">
              <tr className="text-left">
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Date</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Orders</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Items</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Income</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Expenses</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Net</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">AOV</th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Discounts</th>
              </tr>
            </thead>
            <tbody>
              {daySeries.map((d, i) => (
                <tr key={d.date} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2">{d.orders}</td>
                  <td className="px-3 py-2">{d.items}</td>
                  <td className="px-3 py-2 font-extrabold">{money(d.income)}</td>
                  <td className="px-3 py-2">{money(d.expense)}</td>
                  <td className="px-3 py-2">{money(d.net)}</td>
                  <td className="px-3 py-2">{money(d.aov)}</td>
                  <td className="px-3 py-2">{money(d.discounts)}</td>
                </tr>
              ))}
              {!daySeries.length && (
                <tr><td colSpan={8} className="px-3 py-3 text-center text-slate-400">No data in this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Day ledger with actions (only Today view) */}
      {isSingleDay && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Day Ledger — {dayDate}</h2>
            <div className="text-xs bg-[#07132b] px-2 py-1 rounded">Realtime</div>
          </div>

          {/* Mobile ledger (stacked) */}
          <div className="flex flex-col gap-2 md:hidden">
            {ledgerRows.length === 0 ? (
              <div className="p-3 rounded bg-[#07132b] text-center text-slate-400">No entries today.</div>
            ) : ledgerRows.map((r, i) => {
              if (r.type === "sale") {
                const s:any = r.sale!;
                return (
                  <div key={`s-${s.id}`} className="p-3 rounded-lg bg-[#07132b] border border-[#10203a]">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Sale</div>
                      <div className="text-sm font-extrabold">{money(s.total ?? 0)}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">Time: {new Date(s.created_at).toLocaleTimeString()}</div>
                    <div className="mt-2 text-sm">Subtotal {money(s.subtotal ?? 0)} • Discount {money(s.discount ?? 0)}</div>
                  </div>
                );
              } else {
                const t = r.tx!;
                const paid = !!paidMap[t.id];
                return (
                  <div key={`t-${t.id}`} className="p-3 rounded-lg bg-[#07132b] border border-[#10203a]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{t.kind}</div>
                        <div className="text-xs text-slate-400">{t.description || "—"}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-extrabold">{money(t.amount)}</div>
                        <div className="text-xs text-slate-400">{new Date(t.created_at).toLocaleTimeString()}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button className="btn-ghost" onClick={()=>togglePaid(t.id)}>{paid ? "Unmark" : "Mark Paid"}</button>
                      <button className="btn-ghost" onClick={()=>removeTx(t.id)}>Delete</button>
                    </div>
                  </div>
                );
              }
            })}
          </div>

          {/* Desktop ledger table */}
          <div className="hidden overflow-auto md:block">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Time</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Type</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Amount</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Details</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Method/Ref</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-3 text-center text-slate-400">No entries today.</td></tr>
                ) : ledgerRows.map((r, i) => {
                  if (r.type === "sale") {
                    const s:any = r.sale!;
                    return (
                      <tr key={`s-${s.id}`} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(s.created_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2"><span className="tag">sale</span></td>
                        <td className="px-3 py-2 font-extrabold">{money(s.total ?? 0)}</td>
                        <td className="px-3 py-2">Subtotal {money(s.subtotal ?? 0)} • Discount {money(s.discount ?? 0)}</td>
                        <td className="px-3 py-2">{s.method || "—"}</td>
                        <td className="px-3 py-2">—</td>
                      </tr>
                    );
                  } else {
                    const t = r.tx!;
                    const paid = !!paidMap[t.id];
                    return (
                      <tr key={`t-${t.id}`} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(t.created_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2">
                          <span className="tag">{t.kind}</span>{" "}
                          <span className={`tag ${paid ? "paid-pill" : "unpaid-pill"}`}>{paid ? "Paid" : "Unpaid"}</span>
                        </td>
                        <td className="px-3 py-2 font-extrabold">{money(t.amount)}</td>
                        <td className="px-3 py-2">{t.description || "—"}</td>
                        <td className="px-3 py-2">{[t.method, t.reference].filter(Boolean).join(" • ") || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button className="btn-ghost" onClick={()=>togglePaid(t.id)}>{paid ? "Unmark" : "Mark Paid"}</button>
                            <button className="btn-ghost" onClick={()=>removeTx(t.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
